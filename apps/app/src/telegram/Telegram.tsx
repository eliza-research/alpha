// spec/app/telegram/index.md, "Story: Browse and search my Telegram chats"; spec/app/telegram/auth.md, "Story: Sign in to my Telegram user account"; spec/app/telegram/conversation.md, "Story: Read and interact with a Telegram conversation"; spec/app/telegram/composer.md, "Story: Draft and send Telegram messages under my sole authority"
import {
  Alert,
  AppHeader,
  AuthStepFrame,
  Banner,
  Button,
  ChatComposer,
  Chip,
  ConfirmDialog,
  type ConversationKind,
  ConversationRow,
  EmptyState,
  Input,
  Label,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  MessageItem,
  ReactionBar,
  Screen,
  SearchField,
  Skeleton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  WalletQr,
} from "@repo/ui";
import { Effect, type ManagedRuntime } from "effect";
import { ArrowLeft, Bell, BellOff, LogOut, MessageSquare, MoreVertical, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Machine as ChatListMachine } from "../../gen/app__telegram.effect.vibe";
import { type Filter } from "../../gen/app__telegram.ts";
import { useMachine as useChatList } from "../../gen/app__telegram.react.ts";
import type { Machine as AuthMachine } from "../../gen/app__telegram__auth.effect.vibe";
import { type Auth, type Trouble, sensitive } from "../../gen/app__telegram__auth.ts";
import { useMachine as useAuth } from "../../gen/app__telegram__auth.react.ts";
import type { Machine as ComposerMachine } from "../../gen/app__telegram__composer.effect.vibe";
import { useMachine as useComposer } from "../../gen/app__telegram__composer.react.ts";
import type { Machine as ConversationMachine } from "../../gen/app__telegram__conversation.effect.vibe";
import { composable } from "../../gen/app__telegram__conversation.ts";
import { useMachine as useConversation } from "../../gen/app__telegram__conversation.react.ts";
import { useMachine as useNotices } from "../../gen/app__telegram__notices.react.ts";
import type { Machine as NoticesMachine } from "../../gen/app__telegram__notices.effect.vibe";
import { MessagingNotices, type MessagingSessions, Telegram, type TelegramDialogSummary } from "../platform/index.vibe";
import { useTelegramSnapshot } from "./Notice.tsx";
import { openTelegramNotice } from "./notices.vibe";
import { useTimed } from "../runtime/ui.tsx";
import { swapComposerTarget } from "../messaging/composer.ts";
import { untimed } from "../runtime/index.vibe";
import { Time } from "../runtime/index.vibe";
import {
  TelegramStore,
  chatKindOf,
  dialogTitle,
  isDialogMuted,
  senderNameOf,
} from "./store.vibe";

export interface TelegramScreenProps {
  /** Runtime supplying Telegram's auth, chat list, conversation, composer, notices, store, and clock services. */
  runtime: ManagedRuntime.ManagedRuntime<
    AuthMachine | ChatListMachine | ConversationMachine | ComposerMachine | NoticesMachine | TelegramStore | Telegram | MessagingSessions | MessagingNotices | Time,
    unknown
  >;
  onBack?: (() => void) | undefined;
}

type Runtime = TelegramScreenProps["runtime"];

const TROUBLE_MESSAGES: Readonly<Partial<Record<Trouble, string>>> = {
  InvalidPhone: "Enter a valid phone number in international format (for example +15550101234).",
  WrongCode: "That verification code did not match. Check the code and try again.",
  ExpiredCode: "The verification code expired. Request a new code.",
  WrongPassword: "Incorrect two-factor password. Try again.",
  BotTokenRejected: "Bot tokens are not supported. Sign in with your personal Telegram user account.",
  Offline: "Telegram could not be reached while offline.",
  Unreachable: "Telegram did not respond. Please try again.",
  SessionRevoked: "Your Telegram session expired or was revoked. Sign in again to reconnect.",
};

const QUICK_REACTION = "👍";

function withStore<A>(runtime: Runtime, fn: (store: TelegramStore["Service"]) => Effect.Effect<A>): A {
  return runtime.runSync(Effect.flatMap(TelegramStore, fn));
}

function formatUnixTime(seconds: number): string {
  if (seconds <= 0) return "";
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function rowKindOf(dialog: TelegramDialogSummary): ConversationKind {
  if (dialog.peer._type === "peerUser") return "direct";
  if (dialog.peer._type === "peerChat") return "group";
  return "channel-public";
}

function waitNoticeOf(state: Auth, now: number): string | undefined {
  if (state.floodUntil <= now) return undefined;
  const seconds = Math.max(1, Math.ceil((state.floodUntil - now) / 1000));
  return `Too many attempts. Wait ${seconds}s before trying again.`;
}

function AuthScreen({
  state,
  onBack,
  children,
}: {
  state: Auth;
  onBack?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <Screen
      title="Telegram"
      data-alpha-telegram-auth={state.step}
      data-alpha-sensitive={String(sensitive(state))}
      leading={onBack ? <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}><ArrowLeft /></Button> : undefined}
    >
      {children}
    </Screen>
  );
}

function AuthFlow({ runtime, onBack }: { runtime: Runtime; onBack?: (() => void) | undefined }) {
  const auth = useTimed(runtime, useAuth);
  const snap = useTelegramSnapshot(runtime);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const now = runtime.runSync(Time.use((time) => time.latest()));
  if (!auth.state) return null;
  const { state, can, send } = auth;
  const errorText = TROUBLE_MESSAGES[state.trouble];
  const waitNotice = waitNoticeOf(state, now);
  const busy = state.work !== "Idle";

  if (state.step === "SignedOut" || state.step === "SessionExpired") {
    const open = { type: "openSignIn" } as const;
    return (
      <AuthScreen state={state} onBack={onBack}>
        <AuthStepFrame
          platform="Telegram"
          title={state.step === "SessionExpired" ? "Session expired" : "Sign in to Telegram"}
          subtitle="Use your personal Telegram account with phone verification or QR code."
          error={errorText}
          waitNotice={waitNotice}
          primaryAction={{
            label: state.step === "SessionExpired" ? "Sign in again" : "Continue",
            disabled: !can(open),
            loading: busy,
            onClick: () => { void send(open); },
          }}
        />
      </AuthScreen>
    );
  }

  if (state.step === "PhoneEntry") {
    const sendCode = { type: "sendCode", phone: phone.trim(), now: untimed, online: true } as const;
    const startQr = { type: "startQr", now: untimed, online: true } as const;
    return (
      <AuthScreen state={state} onBack={onBack}>
        <AuthStepFrame
          platform="Telegram"
          title="Enter your phone number"
          subtitle="Telegram will send a login code to your account."
          error={errorText}
          waitNotice={waitNotice}
          primaryAction={{
            label: "Send code",
            disabled: !can(sendCode),
            loading: state.work === "SendingCode",
            onClick: () => { void send(sendCode); },
          }}
          secondaryAction={{
            label: "Sign in with QR",
            disabled: !can(startQr),
            onClick: () => { void send(startQr); },
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="telegram-phone">Phone number</Label>
            <Input
              id="telegram-phone"
              aria-label="Phone number"
              type="tel"
              placeholder="+15550101234"
              value={phone}
              disabled={busy}
              onChange={(event) => { setPhone(event.target.value); }}
            />
          </div>
        </AuthStepFrame>
      </AuthScreen>
    );
  }

  if (state.step === "CodePending") {
    const verify = { type: "verifyCode", code: code.trim(), now: untimed, online: true } as const;
    const back = { type: "backToPhone" } as const;
    return (
      <AuthScreen state={state}>
        <AuthStepFrame
          platform="Telegram"
          title="Enter verification code"
          subtitle={snap.auth.phone ? `Code sent to ${snap.auth.phone}` : undefined}
          error={errorText}
          waitNotice={waitNotice}
          onBack={can(back) ? () => { setCode(""); void send(back); } : undefined}
          primaryAction={{
            label: "Verify code",
            disabled: code.trim() === "" || !can(verify),
            loading: state.work === "VerifyingCode",
            onClick: () => { void send(verify); },
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="telegram-code">Verification code</Label>
            <Input
              id="telegram-code"
              aria-label="Verification code"
              inputMode="numeric"
              placeholder="12345"
              value={code}
              disabled={busy}
              onChange={(event) => { setCode(event.target.value); }}
            />
          </div>
        </AuthStepFrame>
      </AuthScreen>
    );
  }

  if (state.step === "TwoFactorRequired") {
    const submitPassword = { type: "checkPassword", password, now: untimed, online: true } as const;
    const back = { type: "backToPhone" } as const;
    return (
      <AuthScreen state={state}>
        <AuthStepFrame
          platform="Telegram"
          title="Two-factor password"
          subtitle={snap.auth.passwordHint ? `Password hint: ${snap.auth.passwordHint}` : "Enter your Telegram cloud password."}
          error={errorText}
          waitNotice={waitNotice}
          onBack={can(back) ? () => { setPassword(""); void send(back); } : undefined}
          primaryAction={{
            label: "Unlock account",
            disabled: password === "" || !can(submitPassword),
            loading: state.work === "CheckingPassword",
            onClick: () => { void send(submitPassword); },
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="telegram-2fa">Two-factor password</Label>
            <Input
              id="telegram-2fa"
              aria-label="Two-factor password"
              type="password"
              placeholder="Cloud password"
              value={password}
              disabled={busy}
              onChange={(event) => { setPassword(event.target.value); }}
            />
          </div>
        </AuthStepFrame>
      </AuthScreen>
    );
  }

  const retry = { type: "startQr", now: untimed, online: true } as const;
  const back = { type: "backToPhone" } as const;
  return (
    <AuthScreen state={state}>
      <AuthStepFrame
        platform="Telegram"
        title="Sign in with QR"
        subtitle="Open Telegram on another device, go to Settings > Devices > Link Desktop Device, and approve this code."
        error={errorText}
        waitNotice={waitNotice}
        primaryAction={can(retry) ? { label: "Get a new code", onClick: () => { void send(retry); } } : undefined}
        onBack={can(back) ? () => { void send(back); } : undefined}
        secondaryAction={can(back) ? { label: "Use phone number", onClick: () => { void send(back); } } : undefined}
      >
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-secondary p-4 text-center">
          {state.qrExpiresAt > 0 && snap.auth.qrLoginUrl ? (
            <WalletQr value={snap.auth.qrLoginUrl} label="Telegram sign-in QR code" />
          ) : busy ? <Spinner label="Getting Telegram sign-in code" /> : null}
        </div>
      </AuthStepFrame>
    </AuthScreen>
  );
}

function AccountMenu({ canSignOut, onRequestSignOut }: { canSignOut: boolean; onRequestSignOut: () => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account options">
          <MoreVertical />
        </Button>
      </MenuTrigger>
      <MenuContent sideOffset={8}>
        <MenuItem destructive disabled={!canSignOut} onSelect={onRequestSignOut}>
          <LogOut aria-hidden />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function ChatListView({
  runtime,
  onBack,
  onRequestSignOut,
  canSignOut,
}: {
  runtime: Runtime;
  onBack?: (() => void) | undefined;
  onRequestSignOut: () => void;
  canSignOut: boolean;
}) {
  const list = useChatList(runtime);
  const conv = useConversation(runtime);
  const notices = useNotices(runtime);
  const snap = useTelegramSnapshot(runtime);
  const [searchInput, setSearchInput] = useState("");
  if (!list.state) return null;
  const { state, can, send } = list;

  const openDialog = (dialog: TelegramDialogSummary) => {
    const chatId = withStore(runtime, (store) => store.chatIdOf(dialog.peer_key));
    const kind = chatKindOf(dialog, snap.chats);
    const event = { type: "openChat", chat: chatId, kind, canPost: dialog.can_post, front: true } as const;
    if (conv.can(event)) void conv.send(event);
  };

  const openPeerKey = (peerKey: string) => {
    const found = snap.dialogs.find((item) => item.peer_key === peerKey);
    if (found) { openDialog(found); return; }
    const chatId = withStore(runtime, (store) => store.chatIdOf(peerKey));
    const event = { type: "openChat", chat: chatId, kind: "DirectMessage" as const, canPost: true, front: true } as const;
    if (conv.can(event)) void conv.send(event);
  };

  const selectTab = (value: string) => {
    const tab = value as Filter;
    const event = { type: "chooseFilter", tab, folderId: 0 } as const;
    if (can(event)) {
      setSearchInput("");
      void send(event);
    }
  };

  const submitSearch = (next: string) => {
    setSearchInput(next);
    const trimmed = next.trim();
    const event = { type: "search", query: trimmed } as const;
    if (can(event)) void send(event);
  };

  const shownDialogs = state.saved ? snap.savedDialogs : snap.dialogs;
  const isSearchMode = state.selected.query !== "";
  const isLoadingFirst = state.list.status === "Loading" && !state.further && shownDialogs.length === 0 && !isSearchMode;

  return (
    <Screen
      title="Telegram"
      data-alpha-telegram-list
      leading={onBack ? <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}><ArrowLeft /></Button> : undefined}
      actions={
        <>
          {can({ type: "refresh" }) ? (
            <Button variant="ghost" size="icon" aria-label="Refresh chats" onClick={() => { void send({ type: "refresh" }); }}>
              <RefreshCw />
            </Button>
          ) : null}
          <AccountMenu canSignOut={canSignOut} onRequestSignOut={onRequestSignOut} />
        </>
      }
    >
      {runtime.runSync(Effect.map(MessagingNotices, (host) => host.native)) ? (
        <Button variant="ghost" onClick={() => void runtime.runPromise(Effect.flatMap(MessagingNotices, (host) => host.configure("telegram")))}>
          {notices.state?.notifyAllowed ? "Notification settings" : "Enable Telegram notifications"}
        </Button>
      ) : null}
      {snap.notices.length > 0 ? (
        <ul aria-label="Telegram notifications">
          {snap.notices.map((notice) => (
            <li key={notice.peerKey}>
              <Button variant="ghost" onClick={() => void runtime.runPromise(openTelegramNotice(notice.scope, notice.peerKey))}>
                {notice.title} · {notice.excerpt}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <SearchField
        aria-label="Search Telegram"
        placeholder="Search messages and chats"
        value={searchInput}
        onValueChange={submitSearch}
        clearLabel="Clear search"
      />
      <Tabs value={state.selected.tab === "FolderChat" ? "AllChats" : state.selected.tab} onValueChange={selectTab}>
        <TabsList aria-label="Chat filters">
          <TabsTrigger value="AllChats">All</TabsTrigger>
          <TabsTrigger value="UnreadChats">Unread</TabsTrigger>
          <TabsTrigger value="PinnedChats">Pinned</TabsTrigger>
          <TabsTrigger value="ArchivedChats">Archived</TabsTrigger>
        </TabsList>
      </Tabs>
      {snap.folders.length > 0 ? (
        <div role="group" aria-label="Folders" className="flex flex-wrap gap-1.5">
          {snap.folders.map((folder) => {
            const active = state.selected.tab === "FolderChat" && state.selected.folderId === folder.id;
            const choose = { type: "chooseFilter", tab: "FolderChat" as const, folderId: folder.id } as const;
            const clear = { type: "chooseFilter", tab: "AllChats" as const, folderId: 0 } as const;
            return (
              <Chip
                key={folder.id}
                onClick={() => {
                  if (active && can(clear)) void send(clear);
                  else if (can(choose)) void send(choose);
                }}
              >
                {folder.title}
              </Chip>
            );
          })}
        </div>
      ) : null}
      {state.saved ? <Banner variant="warn">Showing saved chats while offline.</Banner> : null}
      {state.list.status === "Failed" ? (
        <Banner
          variant="destructive"
          action={can({ type: "refresh" }) ? <Button size="sm" variant="outline" onClick={() => { void send({ type: "refresh" }); }}>Retry</Button> : undefined}
        >
          {state.failure === "Offline" ? "You are offline." : "Could not load Telegram chats."}
        </Banner>
      ) : null}
      {isLoadingFirst ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : isSearchMode ? (
        snap.searchMessages.length === 0 ? (
          <EmptyState title="No messages match your search" icon={<MessageSquare />} />
        ) : (
          <ul aria-label="Search results" className="flex flex-col gap-1">
            {snap.searchMessages.map((msg) => (
              <li key={`${msg.peer_key}:${msg.id}`}>
                <ConversationRow
                  title={senderNameOf(msg.from_id, snap.users, snap.chats, msg.peer_key)}
                  preview={msg.message}
                  time={formatUnixTime(msg.date)}
                  onSelect={() => { openPeerKey(msg.peer_key); }}
                />
              </li>
            ))}
          </ul>
        )
      ) : shownDialogs.length === 0 ? (
        <EmptyState title="No chats in this view" icon={<MessageSquare />} />
      ) : (
        <ul aria-label="Telegram chats" className="flex flex-col gap-1">
          {shownDialogs.map((dialog) => {
            const timeline = snap.historyByPeer.get(dialog.peer_key) ?? [];
            const last = timeline.length > 0 ? timeline[timeline.length - 1] : undefined;
            const title = dialogTitle(dialog, snap.users, snap.chats);
            const muted = isDialogMuted(dialog);
            const online = dialog.peer._type === "peerUser" ? Boolean(snap.users.get(dialog.peer.user_id)?.online) : false;
            return (
              <li key={dialog.peer_key}>
                <ConversationRow
                  title={title}
                  kind={rowKindOf(dialog)}
                  online={online}
                  time={formatUnixTime(dialog.top_date)}
                  preview={last?.message ?? ""}
                  muted={muted}
                  pinned={dialog.pinned}
                  unreadCount={dialog.unread_count}
                  mentionCount={dialog.unread_mentions_count}
                  onSelect={() => { openDialog(dialog); }}
                />
              </li>
            );
          })}
        </ul>
      )}
      {can({ type: "loadMore" }) ? (
        <div className="flex justify-center pt-1">
          <Button variant="secondary" loading={state.list.status === "Loading" && state.further} onClick={() => { void send({ type: "loadMore" }); }}>
            Load more
          </Button>
        </div>
      ) : null}
    </Screen>
  );
}

function ConversationView({
  runtime,
  canSignOut,
  onRequestSignOut,
}: {
  runtime: Runtime;
  canSignOut: boolean;
  onRequestSignOut: () => void;
}) {
  const list = useChatList(runtime);
  const conv = useConversation(runtime);
  const composer = useTimed(runtime, useComposer);
  const snap = useTelegramSnapshot(runtime);
  const [editMessageId, setEditMessageId] = useState<number | undefined>();
  const [editText, setEditText] = useState("");
  if (!conv.state || !composer.state || conv.state.chat === 0) return null;

  const { state, can, send } = conv;
  const peerKey = withStore(runtime, (store) => store.peerKeyOf(state.chat));
  const dialog = peerKey === undefined ? undefined : snap.dialogs.find((item) => item.peer_key === peerKey);
  const title = dialog === undefined ? (peerKey ?? "Chat") : dialogTitle(dialog, snap.users, snap.chats);
  const messages = peerKey === undefined ? [] : (snap.historyByPeer.get(peerKey) ?? []);
  const muted = dialog !== undefined ? isDialogMuted(dialog) : list.state?.mutedChats.includes(state.chat) ?? false;
  const toggleMuteEvent = { type: "toggleMute", chat: state.chat, muted: !muted } as const;
  const canPostHere = composable(state);

  const compState = composer.state;
  const isAlphaBar = compState.barTarget === "AlphaTarget";
  const alphaDraftText = compState.alphaRequests.find((item) => item.chat === state.chat)?.text ?? "";
  const chatDraftText = snap.drafts.get(state.chat) ?? "";
  const isEditing = editMessageId !== undefined;
  const activeInputValue = isEditing ? editText : isAlphaBar ? alphaDraftText : chatDraftText;

  const replyMessage = state.replyTo > 0 ? messages.find((item) => item.id === state.replyTo) : undefined;
  const composerContext = isEditing
    ? { kind: "edit" as const, excerpt: messages.find((item) => item.id === editMessageId)?.message }
    : replyMessage !== undefined
      ? {
        kind: "reply" as const,
        sender: senderNameOf(replyMessage.from_id, snap.users, snap.chats, peerKey ?? ""),
        excerpt: replyMessage.message,
      }
      : undefined;

  const writeDraft = (next: string) => {
    if (isEditing) {
      setEditText(next);
      return;
    }
    if (isAlphaBar) {
      const event = { type: "typeAlphaRequest", chat: state.chat, text: next } as const;
      if (composer.can(event, "Owner")) void composer.send(event, "Owner");
      return;
    }
    const event = { type: "typeDraft", empty: next.trim() === "" } as const;
    if (!composer.can(event, "Owner")) return;
    withStore(runtime, (store) => store.update((current) => {
      const nextDrafts = new Map(current.drafts);
      if (next === "") nextDrafts.delete(state.chat);
      else nextDrafts.set(state.chat, next);
      return { ...current, drafts: nextDrafts };
    }));
    void composer.send(event, "Owner");
  };

  const sendMessage = () => {
    if (isEditing && editMessageId !== undefined) {
      const editEvent = { type: "startEdit", msg: editMessageId } as const;
      if (!can(editEvent) || editText.trim() === "") return;
      withStore(runtime, (store) => store.update((current) => ({
        ...current,
        editDraft: { chat: state.chat, messageId: editMessageId, text: editText.trim() },
      })));
      setEditMessageId(undefined);
      setEditText("");
      void send(editEvent);
      return;
    }
    if (isAlphaBar) {
      const alphaSend = { type: "sendAlphaRequest", chat: state.chat } as const;
      if (composer.can(alphaSend, "Owner")) void composer.send(alphaSend, "Owner");
      return;
    }
    const ownerSend = { type: "send" } as const;
    if (composer.can(ownerSend, "Owner")) void composer.send(ownerSend, "Owner");
  };

  const stagedAlpha = compState.chat === state.chat && compState.slot.author === "AlphaWrote" && chatDraftText !== ""
    ? {
      text: chatDraftText,
      sending: compState.sendOp.outcome === "Recorded" || compState.sendOp.outcome === "Sent",
      onSend: composer.can({ type: "send" }, "Owner")
        ? () => { void composer.send({ type: "send" }, "Owner"); }
        : undefined,
      onEdit: composer.can({ type: "typeDraft", empty: false }, "Owner")
        ? () => { void composer.send({ type: "typeDraft", empty: false }, "Owner"); }
        : undefined,
      onUndo: composer.can({ type: "undoAlphaDraft", now: untimed }, "Owner")
        ? () => {
          withStore(runtime, (store) => store.update((current) => {
            const nextDrafts = new Map(current.drafts);
            nextDrafts.delete(state.chat);
            return { ...current, drafts: nextDrafts, agentStagedDraft: undefined };
          }));
          void composer.send({ type: "undoAlphaDraft", now: untimed }, "Owner");
        }
        : undefined,
    }
    : undefined;

  const swapTarget = () => {
    swapComposerTarget(composer, isAlphaBar);
  };

  const sendAllowed = isEditing
    ? editText.trim() !== "" && can({ type: "startEdit", msg: editMessageId })
    : isAlphaBar
      ? composer.can({ type: "sendAlphaRequest", chat: state.chat }, "Owner")
      : composer.can({ type: "send" }, "Owner");

  return (
    <div data-alpha-telegram-conversation className="flex h-full min-h-0 flex-col bg-background pt-[env(safe-area-inset-top)] text-foreground">
      <AppHeader
        title={title}
        leading={can({ type: "closeChat" }) ? (
          <Button variant="ghost" size="icon" aria-label="Back to chats" onClick={() => { void send({ type: "closeChat" }); }}>
            <ArrowLeft />
          </Button>
        ) : undefined}
        className="mx-auto w-full max-w-(--breakpoint-md) shrink-0"
      >
        {list.can(toggleMuteEvent) ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={muted ? "Unmute chat" : "Mute chat"}
            onClick={() => { void list.send(toggleMuteEvent); }}
          >
            {muted ? <Bell /> : <BellOff />}
          </Button>
        ) : null}
        <AccountMenu canSignOut={canSignOut} onRequestSignOut={onRequestSignOut} />
      </AppHeader>

      <main aria-label={title} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="mx-auto flex w-full max-w-(--breakpoint-md) flex-col gap-2">
          {can({ type: "loadOlder" }) ? (
            <div className="flex justify-center">
              <Button size="sm" variant="secondary" loading={state.read.status === "Loading" && state.further} onClick={() => { void send({ type: "loadOlder" }); }}>
                Load older messages
              </Button>
            </div>
          ) : null}
          {state.read.status === "Loading" && messages.length === 0 ? <Spinner label="Loading messages" /> : null}
          {state.read.status === "Failed" ? <Banner variant="destructive">Could not load conversation history.</Banner> : null}
          {!canPostHere ? <Banner variant="warn">This broadcast channel is read-only.</Banner> : null}
          {compState.sendOp.outcome === "Unknown" && compState.sendChat === state.chat ? (
            <Banner
              variant="warn"
              action={composer.can({ type: "readBack" }, "Owner") ? (
                <Button size="sm" variant="outline" onClick={() => { void composer.send({ type: "readBack" }, "Owner"); }}>
                  Check status
                </Button>
              ) : undefined}
            >
              Alpha could not confirm whether your last message was sent.
            </Banner>
          ) : null}
          <div role="log" aria-label="Telegram messages" className="flex flex-col gap-1.5">
            {messages.map((msg) => {
              const quoted = msg.reply_to_msg_id === undefined ? undefined : messages.find((item) => item.id === msg.reply_to_msg_id);
              const existingQuick = msg.reactions.find((item) => item.emoticon === QUICK_REACTION);
              const toggleQuick = { type: "toggleReact", msg: msg.id, emoji: QUICK_REACTION, add: !existingQuick?.chosen } as const;
              return (
                <MessageItem
                  key={msg.id}
                  layout="bubble"
                  sender={senderNameOf(msg.from_id, snap.users, snap.chats, peerKey ?? "")}
                  own={msg.out}
                  time={formatUnixTime(msg.date)}
                  body={msg.message}
                  edited={msg.edit_date !== undefined}
                  replyTo={quoted === undefined ? undefined : {
                    sender: senderNameOf(quoted.from_id, snap.users, snap.chats, peerKey ?? ""),
                    excerpt: quoted.message,
                  }}
                  onReply={can({ type: "setReply", msg: msg.id }) ? () => { void send({ type: "setReply", msg: msg.id }); } : undefined}
                  onEdit={msg.out && can({ type: "startEdit", msg: msg.id }) ? () => { setEditMessageId(msg.id); setEditText(msg.message); } : undefined}
                  onDelete={can({ type: "askDelete", msg: msg.id }) ? () => { void send({ type: "askDelete", msg: msg.id }); } : undefined}
                  onReact={can(toggleQuick) ? () => { void send(toggleQuick); } : undefined}
                  reactions={msg.reactions.length > 0 ? (
                    <ReactionBar
                      reactions={msg.reactions.map((item) => ({ emoji: item.emoticon, count: item.count, reacted: item.chosen }))}
                      onToggle={(emoji) => {
                        if (typeof emoji !== "string") return;
                        const found = msg.reactions.find((item) => item.emoticon === emoji);
                        const reactEvent = { type: "toggleReact", msg: msg.id, emoji, add: !found?.chosen } as const;
                        if (can(reactEvent)) void send(reactEvent);
                      }}
                    />
                  ) : undefined}
                />
              );
            })}
          </div>
        </div>
      </main>

      {canPostHere ? (
        <ChatComposer
          className="pb-24"
          target={isAlphaBar ? "alpha" : "chat"}
          targetAvatar={{ name: title }}
          onSwapTarget={swapTarget}
          value={activeInputValue}
          onValueChange={writeDraft}
          placeholder={isEditing ? "Edit message" : isAlphaBar ? "Ask Alpha about this chat" : `Message ${title}`}
          label={isEditing ? "Edit message" : isAlphaBar ? "Ask Alpha" : "Message"}
          context={composerContext}
          onCancelContext={isEditing
            ? () => { setEditMessageId(undefined); setEditText(""); }
            : can({ type: "clearReply" })
              ? () => { void send({ type: "clearReply" }); }
              : undefined}
          stagedDraft={stagedAlpha}
          sending={compState.sendOp.outcome === "Recorded" || compState.sendOp.outcome === "Sent"}
          sendLabel={isEditing ? "Save edit" : isAlphaBar ? "Ask Alpha" : "Send"}
          onSend={sendAllowed ? sendMessage : undefined}
        />
      ) : null}

      <ConfirmDialog
        open={state.deleteReview.showing}
        title="Delete message?"
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const confirm = { type: "confirmDelete", forEveryone: true } as const;
          if (can(confirm)) void send(confirm);
        }}
        onCancel={() => {
          const dismiss = { type: "dismissDelete" } as const;
          if (can(dismiss)) void send(dismiss);
        }}
      >
        This will delete the selected message from Telegram.
      </ConfirmDialog>
    </div>
  );
}

/**
 * First-class Telegram user-account messaging screen: phone/OTP/2FA/QR auth, chat list with tabs and search,
 * conversation timeline with inline reply/edit/delete/reactions, AP-16 single composer bar with Alpha staged draft
 * review, and explicit sign-out confirmation.
 * @model spec/app/telegram/index.md
 */
export function TelegramScreen({ runtime, onBack }: TelegramScreenProps) {
  const auth = useTimed(runtime, useAuth);
  const conv = useConversation(runtime);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  if (auth.cause) return <Alert variant="destructive" className="m-4">Alpha could not open Telegram</Alert>;
  if (!auth.state) return null;
  if (runtime.runSync(Effect.map(Telegram, (client) => client.accountAccess)) === "officialWeb") {
    return (
      <Screen title="Telegram" data-alpha-sensitive="true" leading={onBack ? <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}><ArrowLeft /></Button> : null}>
        <div className="flex flex-col items-start gap-3 p-4">
          <p className="text-sm text-muted-foreground">The built-in Telegram connection is unavailable on this phone.</p>
          <Button asChild><a href="https://web.telegram.org/a/" rel="noreferrer">Open Telegram Web</a></Button>
        </div>
      </Screen>
    );
  }
  if (auth.state.step !== "Authenticated") {
    return <AuthFlow runtime={runtime} onBack={onBack} />;
  }
  const canSignOut = auth.can({ type: "signOut" });
  return (
    <>
      {conv.state && conv.state.chat > 0 ? (
        <ConversationView
          runtime={runtime}
          canSignOut={canSignOut}
          onRequestSignOut={() => { setConfirmSignOut(true); }}
        />
      ) : (
        <ChatListView
          runtime={runtime}
          onBack={onBack}
          canSignOut={canSignOut}
          onRequestSignOut={() => { setConfirmSignOut(true); }}
        />
      )}
      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of Telegram?"
        confirmLabel="Sign out"
        destructive
        onConfirm={() => {
          setConfirmSignOut(false);
          if (auth.can({ type: "signOut" })) void auth.send({ type: "signOut" });
        }}
        onCancel={() => { setConfirmSignOut(false); }}
      >
        Signing out clears cached Telegram chats, messages, and drafts from this phone.
      </ConfirmDialog>
    </>
  );
}
