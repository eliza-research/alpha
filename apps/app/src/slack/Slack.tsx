// spec/app/slack/index.md, "Story: Switch workspaces and browse Slack conversations with strict isolation"; spec/app/slack/auth.md, "Story: Connect and manage my Slack workspaces with user tokens only"; spec/app/slack/conversation.md, "Story: Read Slack channels and threaded replies accurately"; spec/app/slack/composer.md, "Story: Draft and send Slack messages and thread replies safely"
import { useSlackLedger } from "./Notice.tsx";
import { configureSlackNotices, openSlackNotice } from "./notice-targets.vibe";
import {
  type AuthScopeItem,
  AppHeader,
  AuthStepFrame,
  Banner,
  Button,
  ChatComposer,
  ConfirmDialog,
  type ConversationKind,
  ConversationRow,
  EmptyState,
  ListGroup,
  ListRow,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  MessageItem,
  ReactionBar,
  Screen,
  SearchField,
  Sheet,
  SheetContent,
  Skeleton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import type { ManagedRuntime } from "effect";
import { ArrowLeft, Bell, BellOff, ChevronDown, Hash, LogOut, MessageSquare, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { Machine as WorkspacesMachine, Section } from "../../gen/app__slack.effect.vibe";
import { useMachine as useWorkspaces } from "../../gen/app__slack.react.ts";
import type { Machine as AgentMachine } from "../../gen/app__slack__agent.effect.vibe";
import { type Machine as AuthMachine, type Trouble, sensitive } from "../../gen/app__slack__auth.effect.vibe";
import { useMachine as useAuth } from "../../gen/app__slack__auth.react.ts";
import type { Machine as ComposerMachine } from "../../gen/app__slack__composer.effect.vibe";
import { useMachine as useComposer } from "../../gen/app__slack__composer.react.ts";
import type { Machine as ConversationMachine } from "../../gen/app__slack__conversation.effect.vibe";
import { useMachine as useConversation } from "../../gen/app__slack__conversation.react.ts";
import { useMachine as useNotices } from "../../gen/app__slack__notices.react.ts";
import type { Machine as NoticesMachine } from "../../gen/app__slack__notices.effect.vibe";
import { type MessagingSessions, type MessagingNotices, type Slack, native, type SlackChannelSummary, type SlackMessage, type SlackUser } from "../platform/index.vibe";
import { useTimed } from "../runtime/ui.tsx";
import { swapComposerTarget } from "../messaging/composer.ts";
import { untimed } from "../runtime/index.vibe";
import type { Time } from "../runtime/index.vibe";
import {
  type SlackLedgerStore,
  type SlackLedger,
  type WorkspaceMeta,
  channelTitleOf,
  convKindOf,
  formatSlackTs,
  messageSenderName,
} from "./ledger.vibe";

/** Minimum Effect runtime services required by `SlackScreen`. */
export type SlackRuntime = ManagedRuntime.ManagedRuntime<
  AuthMachine | WorkspacesMachine | ConversationMachine | ComposerMachine | AgentMachine | NoticesMachine | SlackLedger | Slack | MessagingNotices | MessagingSessions | Time,
  unknown
>;

export interface SlackScreenProps {
  /** Runtime providing the Slack spec machines, non-secret ledger, and Alpha clock. */
  runtime: SlackRuntime;
}

const SLACK_CONSENT_SCOPES: AuthScopeItem[] = [
  { scope: "channels:read · channels:history · channels:write", description: "Browse public channels, read messages and mark them as read" },
  { scope: "groups:read · groups:history · groups:write", description: "Browse private channels, read messages and mark them as read" },
  { scope: "im:read · im:history · im:write · mpim:read · mpim:history · mpim:write", description: "Open, read and mark direct messages and group DMs" },
  { scope: "chat:write · reactions:read · reactions:write", description: "Send, edit, delete messages and toggle reactions as you" },
  { scope: "search:read · users:read · team:read", description: "Search workspace messages and show workspace member names" },
];

const TROUBLE_MESSAGES: Partial<Record<Trouble, string>> = {
  BotTokenRejected: "Slack issued a different kind of token. Connect with your personal Slack account.",
  StateMismatch: "OAuth state mismatch. Please start connecting again.",
  ExchangeFailed: "Could not complete Slack sign-in. Try again.",
  WorkspaceRevoked: "A workspace session was revoked. Reconnect to continue using it.",
  ConsentDeclined: "Scope consent was declined.",
  Offline: "You appear to be offline.",
};

const SECTION_TABS: ReadonlyArray<{ readonly value: Section; readonly label: string }> = [
  { value: "AllConversations", label: "All" },
  { value: "UnreadConversations", label: "Unread" },
  { value: "MentionsAndThreads", label: "Mentions" },
  { value: "Channels", label: "Channels" },
  { value: "DirectMessages", label: "DMs" },
];

function uiKindOf(ch: SlackChannelSummary): ConversationKind {
  if (ch.is_im) return "direct";
  if (ch.is_mpim) return "group";
  if (ch.is_private || ch.is_group) return "channel-private";
  return "channel-public";
}

function messageReactions(msg: SlackMessage, ownerId: string) {
  return (msg.reactions ?? []).map((r) => ({
    emoji: r.name,
    count: r.count,
    reacted: r.users.includes(ownerId),
    label: r.name,
  }));
}

function SlackAuthView({
  auth,
  ledger,
  hasExistingWorkspaces,
}: {
  auth: ReturnType<typeof useAuth>;
  ledger: SlackLedgerStore;
  hasExistingWorkspaces: boolean;
}) {
  const state = auth.state;
  if (!state) return null;
  const troubleText = TROUBLE_MESSAGES[state.trouble];
  const pending = ledger.pendingOAuth();

  const authAttrs = {
    "data-alpha-slack-auth": state.step,
    "data-alpha-sensitive": String(sensitive(state)),
  };

  if (state.step === "ScopeConsent") {
    return (
      <Screen title="Slack" {...authAttrs}>
        <AuthStepFrame
          platform="Slack"
          title="Review Slack user scopes"
          subtitle="Alpha connects to Slack as you."
          accountNotice="User account · no bot token"
          error={troubleText}
          scopes={SLACK_CONSENT_SCOPES}
          onBack={auth.can({ type: "declineConsent" }) ? () => void auth.send({ type: "declineConsent" }) : undefined}
          primaryAction={{
            label: "Approve & connect",
            disabled: !auth.can({ type: "approveConsent", online: true }),
            onClick: () => void auth.send({ type: "approveConsent", online: true }),
          }}
          secondaryAction={auth.can({ type: "declineConsent" }) ? {
            label: "Cancel",
            onClick: () => void auth.send({ type: "declineConsent" }),
          } : undefined}
        />
      </Screen>
    );
  }

  if (state.step === "BrowserOAuth") {
    return (
      <Screen title="Slack" {...authAttrs}>
        <AuthStepFrame
          platform="Slack"
          title="Continue in Slack"
          subtitle="Complete OAuth2 PKCE user sign-in in your browser to link this workspace."
          accountNotice="User account · no bot token"
          error={troubleText}
          onBack={auth.can({ type: "cancelOAuth" }) ? () => void auth.send({ type: "cancelOAuth" }) : undefined}
          secondaryAction={auth.can({ type: "cancelOAuth" }) ? {
            label: "Cancel",
            onClick: () => void auth.send({ type: "cancelOAuth" }),
          } : undefined}
        >
          {pending && !native() ? (
            <Button asChild><a href={pending.authorizeUrl} target="_blank" rel="noopener noreferrer">Open Slack in your browser</a></Button>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size="sm" />
              <span>{pending ? "Waiting for Slack…" : "Preparing sign-in…"}</span>
            </div>
          )}
        </AuthStepFrame>
      </Screen>
    );
  }

  if (state.step === "Exchanging") {
    return (
      <Screen title="Slack" {...authAttrs}>
        <AuthStepFrame
          platform="Slack"
          title="Verifying user token"
          subtitle="Checking your Slack workspace and user account."
          accountNotice="User account · no bot token"
          primaryAction={{ label: "Verifying...", loading: true, disabled: true }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Slack" {...authAttrs}>
      <AuthStepFrame
        platform="Slack"
        title={hasExistingWorkspaces ? "Add Slack workspace" : "Connect Slack"}
        subtitle="Sign in with your own Slack user account across one or more workspaces."
        accountNotice="User account · no bot token"
        error={troubleText}
        primaryAction={{
          label: "Connect workspace",
          disabled: !auth.can({ type: "startConnect" }),
          onClick: () => void auth.send({ type: "startConnect" }),
        }}
      >
        {state.trouble === "ExchangeFailed" ? (
          <a className="underline" href="https://app.slack.com/client" rel="noreferrer">Use Slack in a browser without linking Alpha</a>
        ) : null}
      </AuthStepFrame>
    </Screen>
  );
}

function SlackMessageTimeline({
  messages,
  users,
  ownerId,
  workspace,
  channel,
  isThread,
  ledger,
  conv,
  onStartEdit,
  onOpenThread,
}: {
  messages: ReadonlyArray<SlackMessage>;
  users: ReadonlyMap<string, SlackUser>;
  ownerId: string;
  workspace: number;
  channel: number;
  isThread: boolean;
  ledger: SlackLedgerStore;
  conv: ReturnType<typeof useConversation>;
  onStartEdit: (ts: number, body: string) => void;
  onOpenThread: (threadTs: number) => void;
}) {
  return (
    <div className="flex flex-col divide-y divide-border/40">
      {messages.map((msg, idx) => {
        const prev = idx > 0 ? messages[idx - 1] : undefined;
        const senderId = msg.user ?? msg.bot_id;
        const grouped = prev !== undefined && senderId !== undefined && (prev.user ?? prev.bot_id) === senderId && !isThread;
        const own = msg.user === ownerId;
        const tsNum = ledger.tsNum(workspace, channel, msg.ts);
        const reactions = messageReactions(msg, ownerId);
        const reactedThumbs = reactions.some((r) => r.emoji === "thumbsup" && r.reacted);
        const replyCount = msg.reply_count ?? 0;
        return (
          <MessageItem
            key={msg.ts}
            layout="compact"
            sender={messageSenderName(users, msg)}
            grouped={grouped}
            own={own}
            time={formatSlackTs(msg.ts)}
            body={msg.text}
            edited={Boolean(msg.edited)}
            onReply={!isThread && conv.can({ type: "openThread", threadTs: tsNum }) ? () => onOpenThread(tsNum) : undefined}
            onReact={conv.can({ type: "toggleReact", ts: tsNum, emoji: "thumbsup", add: !reactedThumbs })
              ? () => void conv.send({ type: "toggleReact", ts: tsNum, emoji: "thumbsup", add: !reactedThumbs })
              : undefined}
            onEdit={own && conv.can({ type: "startEdit", ts: tsNum }) ? () => onStartEdit(tsNum, msg.text) : undefined}
            onDelete={own && conv.can({ type: "askDelete", ts: tsNum }) ? () => void conv.send({ type: "askDelete", ts: tsNum }) : undefined}
            thread={!isThread && replyCount > 0 && conv.can({ type: "openThread", threadTs: tsNum })
              ? {
                  replyCount,
                  lastReplyTime: msg.latest_reply ? formatSlackTs(msg.latest_reply) : undefined,
                  onOpen: () => onOpenThread(tsNum),
                }
              : undefined}
            reactions={reactions.length > 0 ? (
              <ReactionBar
                reactions={reactions}
                onToggle={(emoji) => {
                  if (typeof emoji !== "string") return;
                  const existing = reactions.find((r) => r.emoji === emoji);
                  const add = !(existing?.reacted ?? false);
                  if (conv.can({ type: "toggleReact", ts: tsNum, emoji, add })) {
                    void conv.send({ type: "toggleReact", ts: tsNum, emoji, add });
                  }
                }}
              />
            ) : undefined}
          />
        );
      })}
    </div>
  );
}

function SlackChannelView({
  workspaces,
  conv,
  composer,
  ledger,
  users,
  ownerId,
  rateNotice,
  liveNotices,
  noticeControls,
  onOpenThread,
  onCloseThread,
  onCloseChannel,
}: {
  workspaces: ReturnType<typeof useWorkspaces>;
  conv: ReturnType<typeof useConversation>;
  composer: ReturnType<typeof useComposer>;
  ledger: SlackLedgerStore;
  users: ReadonlyMap<string, SlackUser>;
  ownerId: string;
  rateNotice: string | undefined;
  liveNotices: boolean;
  noticeControls: React.ReactNode;
  onOpenThread: (threadTs: number) => void;
  onCloseThread: () => void;
  onCloseChannel: () => void;
}) {
  const [editing, setEditing] = useState<{ readonly ts: number; readonly original: string; readonly draft: string } | undefined>(undefined);
  const wsState = workspaces.state;
  const convState = conv.state;
  const compState = composer.state;
  if (!wsState || !convState || !compState) return null;

  const isThread = convState.threadTs > 0;
  const channelSummary = ledger.channelOf(convState.workspace, convState.channel);
  const channelLabel = channelSummary
    ? (channelSummary.is_im || channelSummary.is_mpim ? channelTitleOf(channelSummary, users, ownerId) : `#${channelSummary.name}`)
    : "Channel";
  const isMuted = wsState.mutedChannels.includes(convState.channel) || Boolean(channelSummary?.is_muted);
  const messages = isThread
    ? ledger.threadMessagesOf(convState.workspace, convState.channel, convState.threadTs)
    : ledger.channelMessagesOf(convState.workspace, convState.channel);
  const target = compState.active;
  const isAlphaBar = compState.barTarget === "AlphaTarget";
  const stagedText = compState.slot.author === "AlphaWrote" ? ledger.stagedAlphaDraft(target) : undefined;
  const composerValue = editing ? editing.draft : isAlphaBar ? ledger.alphaRequestText(target) : ledger.draftText(target);
  const sendingNow = compState.sendOp.outcome === "Recorded" || compState.sendOp.outcome === "Sent";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <AppHeader
        title={isThread ? `Thread · ${channelLabel}` : channelLabel}
        leading={(
          <Button
            variant="ghost"
            size="icon"
            aria-label={isThread ? "Back to channel" : "Back to conversations"}
            onClick={() => {
              setEditing(undefined);
              if (isThread) onCloseThread();
              else onCloseChannel();
            }}
          >
            <ArrowLeft />
          </Button>
        )}
      >
        {!isThread && liveNotices ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={isMuted ? "Unmute Alpha notifications" : "Mute Alpha notifications"}
            disabled={!workspaces.can({ type: "toggleMute", channel: convState.channel, muted: !isMuted })}
            onClick={() => void workspaces.send({ type: "toggleMute", channel: convState.channel, muted: !isMuted })}
          >
            {isMuted ? <BellOff /> : <Bell />}
          </Button>
        ) : null}
      </AppHeader>

      <main className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {noticeControls}
        {rateNotice ? <Banner variant="warn" className="mb-2">{rateNotice}</Banner> : null}
        {!isThread && conv.can({ type: "loadOlderChannel" }) ? (
          <div className="mb-2 flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => void conv.send({ type: "loadOlderChannel" })}>
              Load older messages
            </Button>
          </div>
        ) : null}
        {isThread && conv.can({ type: "loadOlderThread" }) ? (
          <div className="mb-2 flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => void conv.send({ type: "loadOlderThread" })}>
              Load older replies
            </Button>
          </div>
        ) : null}
        {(isThread ? convState.threadRead.status === "Loading" : convState.channelRead.status === "Loading") && messages.length === 0 ? (
          <div className="flex flex-col gap-2 px-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : messages.length === 0 ? (
          <EmptyState title={isThread ? "No replies yet" : "No messages yet"} icon={<MessageSquare />} />
        ) : (
          <SlackMessageTimeline
            messages={messages}
            users={users}
            ownerId={ownerId}
            workspace={convState.workspace}
            channel={convState.channel}
            isThread={isThread}
            ledger={ledger}
            conv={conv}
            onStartEdit={(ts, body) => setEditing({ ts, original: body, draft: body })}
            onOpenThread={onOpenThread}
          />
        )}
      </main>

      <ChatComposer
        className="pb-24"
        target={isAlphaBar ? "alpha" : "chat"}
        targetAvatar={{ name: channelLabel }}
        onSwapTarget={() => { swapComposerTarget(composer, isAlphaBar); }}
        value={composerValue}
        placeholder={isAlphaBar ? "Ask Alpha about this Slack conversation" : isThread ? "Reply in thread..." : `Message ${channelLabel}`}
        context={editing ? { kind: "edit", excerpt: editing.original } : undefined}
        onCancelContext={editing ? () => setEditing(undefined) : undefined}
        broadcast={isThread ? compState.replyBroadcast : undefined}
        onBroadcastChange={isThread && composer.can({ type: "toggleBroadcast", on: !compState.replyBroadcast }, "Owner")
          ? (checked) => void composer.send({ type: "toggleBroadcast", on: checked }, "Owner")
          : undefined}
        stagedDraft={stagedText ? {
          text: stagedText,
          sending: sendingNow,
          onSend: composer.can({ type: "send" }, "Owner") ? () => void composer.send({ type: "send" }, "Owner") : undefined,
          onEdit: composer.can({ type: "typeDraft", empty: false }, "Owner")
            ? () => {
                ledger.setDraftText(target, stagedText);
                ledger.setStagedAlphaDraft(target, undefined);
                void composer.send({ type: "typeDraft", empty: false }, "Owner");
              }
            : undefined,
          onUndo: composer.can({ type: "undoAlphaDraft", now: untimed }, "Owner")
            ? () => {
                ledger.setStagedAlphaDraft(target, undefined);
                void composer.send({ type: "undoAlphaDraft", now: untimed }, "Owner");
              }
            : undefined,
        } : undefined}
        sending={sendingNow}
        onValueChange={(next) => {
          if (editing) {
            setEditing({ ...editing, draft: next });
            return;
          }
          if (isAlphaBar) {
            ledger.setAlphaRequestText(target, next);
            if (composer.can({ type: "typeAlphaRequest", workspace: target.workspace, channel: target.channel, threadTs: target.threadTs, text: next }, "Owner")) {
              void composer.send({ type: "typeAlphaRequest", workspace: target.workspace, channel: target.channel, threadTs: target.threadTs, text: next }, "Owner");
            }
            return;
          }
          ledger.setDraftText(target, next);
          const empty = next.trim() === "";
          if (composer.can({ type: "typeDraft", empty }, "Owner")) {
            void composer.send({ type: "typeDraft", empty }, "Owner");
          }
        }}
        onSend={editing
          ? (editing.draft.trim() !== "" && conv.can({ type: "startEdit", ts: editing.ts })
              ? () => {
                  ledger.setPendingEdit(convState.workspace, convState.channel, editing.ts, editing.draft.trim());
                  void conv.send({ type: "startEdit", ts: editing.ts });
                  setEditing(undefined);
                }
              : undefined)
          : isAlphaBar
            ? (composer.can({ type: "sendAlphaRequest", workspace: target.workspace, channel: target.channel, threadTs: target.threadTs }, "Owner")
                ? () => {
                    ledger.setAlphaRequestText(target, "");
                    void composer.send({ type: "sendAlphaRequest", workspace: target.workspace, channel: target.channel, threadTs: target.threadTs }, "Owner");
                  }
                : undefined)
            : (composer.can({ type: "send" }, "Owner") ? () => void composer.send({ type: "send" }, "Owner") : undefined)}
      />

      <ConfirmDialog
        open={convState.deleteReview.showing}
        title="Delete this Slack message?"
        confirmLabel="Delete"
        destructive
        onConfirm={() => { if (conv.can({ type: "confirmDelete" })) void conv.send({ type: "confirmDelete" }); }}
        onCancel={() => { if (conv.can({ type: "dismissDelete" })) void conv.send({ type: "dismissDelete" }); }}
      >
        This removes the message from the workspace for everyone.
      </ConfirmDialog>
    </div>
  );
}

function SlackWorkspaceListView({
  auth,
  workspaces,
  ledger,
  connectedMetas,
  activeMeta,
  users,
  ownerId,
  rateNotice,
  noticeControls,
  onOpenChannel,
}: {
  auth: ReturnType<typeof useAuth>;
  workspaces: ReturnType<typeof useWorkspaces>;
  ledger: SlackLedgerStore;
  connectedMetas: ReadonlyArray<WorkspaceMeta>;
  activeMeta: WorkspaceMeta | undefined;
  users: ReadonlyMap<string, SlackUser>;
  ownerId: string;
  rateNotice: string | undefined;
  noticeControls: React.ReactNode;
  onOpenChannel: (workspace: number, channelNum: number, summary?: SlackChannelSummary) => void;
}) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState<WorkspaceMeta | undefined>(undefined);
  const [searchInput, setSearchInput] = useState("");

  const authState = auth.state;
  const wsState = workspaces.state;
  if (!authState || !wsState) return null;

  const activeWorkspace = wsState.selected.workspace;
  const conversations = ledger.conversationsOf(activeWorkspace);
  const searchMatches = ledger.searchMatchesOf(activeWorkspace);
  const showingSearch = wsState.selected.query !== "";

  return (
    <Screen
      title={activeMeta?.name ?? "Slack"}
      actions={(
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Switch workspace" onClick={() => setSwitcherOpen(true)}>
            <ChevronDown className="size-4" />
            <span>Workspaces</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh Slack"
            disabled={!workspaces.can({ type: "refresh" })}
            onClick={() => void workspaces.send({ type: "refresh" })}
          >
            <RefreshCw />
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Slack options">
                <Plus />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem disabled={!auth.can({ type: "startConnect" })} onSelect={() => void auth.send({ type: "startConnect" })}>
                <Plus aria-hidden />
                <span>Add workspace</span>
              </MenuItem>
              {activeMeta ? (
                <MenuItem
                  destructive
                  disabled={!auth.can({ type: "signOutWorkspace", workspace: activeMeta.num })}
                  onSelect={() => setConfirmSignOut(activeMeta)}
                >
                  <LogOut aria-hidden />
                  <span>Sign out {activeMeta.name}</span>
                </MenuItem>
              ) : null}
            </MenuContent>
          </Menu>
        </div>
      )}
    >
      {authState.trouble === "WorkspaceRevoked" ? <Banner variant="destructive">{TROUBLE_MESSAGES.WorkspaceRevoked}</Banner> : null}
      {rateNotice ? <Banner variant="warn">{rateNotice}</Banner> : null}
      {noticeControls}
      {!activeMeta?.brokered ? <Banner variant="info">Live Slack notifications are unavailable. Refresh to read the latest messages.</Banner> : null}
      {wsState.saved ? <Banner variant="info">Showing saved workspace cache</Banner> : null}
      {wsState.failure !== "Fine" ? (
        <Banner variant="destructive">
          {wsState.failure === "Revoked" ? "Workspace token revoked. Reconnect to continue." : "Could not reach Slack."}
        </Banner>
      ) : null}

      <SearchField
        aria-label="Search Slack messages"
        placeholder="Search (in:#channel, from:@user)"
        value={searchInput}
        onValueChange={(next) => {
          setSearchInput(next);
          if (workspaces.can({ type: "search", query: next })) void workspaces.send({ type: "search", query: next });
        }}
      />

      <Tabs
        value={wsState.selected.section}
        onValueChange={(next) => {
          const section = next as Section;
          setSearchInput("");
          if (workspaces.can({ type: "chooseSection", section })) void workspaces.send({ type: "chooseSection", section });
        }}
      >
        <TabsList aria-label="Slack sections">
          {SECTION_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {wsState.list.status === "Loading" && conversations.length === 0 && !showingSearch ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : showingSearch ? (
        searchMatches.length === 0 ? (
          <EmptyState title="No matching messages" icon={<Hash />} />
        ) : (
          <ListGroup>
            {searchMatches.map((match) => {
              const chNum = ledger.channelNum(activeWorkspace, match.channel.id);
              return (
                <ListRow
                  key={`${match.channel.id}:${match.ts}`}
                  title={`#${match.channel.name} · ${match.username}`}
                  detail={match.text}
                  trailing={formatSlackTs(match.ts)}
                  onClick={() => onOpenChannel(activeWorkspace, chNum, ledger.channelOf(activeWorkspace, chNum))}
                />
              );
            })}
          </ListGroup>
        )
      ) : conversations.length === 0 ? (
        <EmptyState title="No conversations here" icon={<Hash />} />
      ) : (
        <div className="flex flex-col gap-1">
          {conversations.map((ch) => {
            const chNum = ledger.channelNum(activeWorkspace, ch.id);
            const unreadCount = ch.unread_count_display ?? ch.unread_count ?? 0;
            const hasMention = ownerId !== "" && (ch.latest?.text ?? "").includes(`<@${ownerId}>`) && unreadCount > 0;
            const muted = wsState.mutedChannels.includes(chNum) || Boolean(ch.is_muted);
            return (
              <ConversationRow
                key={ch.id}
                title={channelTitleOf(ch, users, ownerId)}
                kind={uiKindOf(ch)}
                preview={ch.latest?.text}
                previewSender={ch.latest ? messageSenderName(users, ch.latest) : undefined}
                time={ch.latest ? formatSlackTs(ch.latest.ts) : undefined}
                muted={muted}
                unreadCount={unreadCount}
                mentionCount={hasMention ? 1 : 0}
                onSelect={() => onOpenChannel(activeWorkspace, chNum, ch)}
              />
            );
          })}
          {workspaces.can({ type: "loadMore" }) ? (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" onClick={() => void workspaces.send({ type: "loadMore" })}>
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <Sheet open={switcherOpen} onOpenChange={setSwitcherOpen}>
        <SheetContent
          title="Slack workspaces"
          description="Each workspace keeps its own isolated user token, cache, drafts and notices."
          actions={(
            <Button
              variant="primary"
              disabled={!auth.can({ type: "startConnect" })}
              onClick={() => {
                setSwitcherOpen(false);
                void auth.send({ type: "startConnect" });
              }}
            >
              Add workspace
            </Button>
          )}
        >
          <ListGroup>
            {connectedMetas.map((meta) => (
              <div key={meta.teamId} className="flex items-center gap-1 pr-2">
                <ListRow
                  className="min-w-0 flex-1"
                  title={meta.name}
                  detail={`Team ${meta.teamId}`}
                  selected={meta.num === activeWorkspace}
                  onClick={() => {
                    setSwitcherOpen(false);
                    if (workspaces.can({ type: "switchWorkspace", workspace: meta.num })) {
                      void workspaces.send({ type: "switchWorkspace", workspace: meta.num });
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Sign out ${meta.name}`}
                  disabled={!auth.can({ type: "signOutWorkspace", workspace: meta.num })}
                  onClick={() => {
                    setSwitcherOpen(false);
                    setConfirmSignOut(meta);
                  }}
                >
                  Sign out
                </Button>
              </div>
            ))}
          </ListGroup>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmSignOut !== undefined}
        title={confirmSignOut ? `Sign out of ${confirmSignOut.name}?` : "Sign out?"}
        confirmLabel="Sign out"
        destructive
        onConfirm={() => {
          if (confirmSignOut && auth.can({ type: "signOutWorkspace", workspace: confirmSignOut.num })) {
            void auth.send({ type: "signOutWorkspace", workspace: confirmSignOut.num });
          }
          setConfirmSignOut(undefined);
        }}
        onCancel={() => setConfirmSignOut(undefined)}
      >
        This revokes your user token and wipes local cache, drafts and notices for this workspace only.
      </ConfirmDialog>
    </Screen>
  );
}

/** First-class multi-workspace Slack user-account screen driven strictly by the Slack spec machines. */
export function SlackScreen({ runtime }: SlackScreenProps) {
  const auth = useAuth(runtime);
  const workspaces = useWorkspaces(runtime);
  const conv = useConversation(runtime);
  const composer = useTimed(runtime, useComposer);
  const ledger = useSlackLedger(runtime);
  const noticesAllowed = useNotices(runtime).state?.notifyAllowed === true;

  const authState = auth.state;
  const wsState = workspaces.state;
  const convState = conv.state;
  const compState = composer.state;

  if (!authState || !wsState || !convState || !compState) {
    return (
      <Screen title="Slack">
        <Skeleton className="h-16 w-full" />
      </Screen>
    );
  }

  const connectedMetas = ledger.connectedMetas(authState.connected.map((w) => w.workspace));
  if (authState.connected.length === 0 || authState.step !== "Idle") {
    return <SlackAuthView auth={auth} ledger={ledger} hasExistingWorkspaces={authState.connected.length > 0} />;
  }

  const activeWorkspace = wsState.selected.workspace;
  const activeMeta = ledger.workspaceMeta(activeWorkspace);
  const liveNotices = activeMeta?.brokered === true;
  const noticeControls = <>
    {liveNotices && !noticesAllowed ? (
      <Button variant="ghost" onClick={() => void runtime.runPromise(configureSlackNotices)}>Enable Slack notifications</Button>
    ) : null}
    {ledger.noticesList().map((notice) => (
      <Button key={notice.key} variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => void runtime.runPromise(openSlackNotice(notice.destination))}>
        {notice.title} · {notice.body}
      </Button>
    ))}
  </>;
  const users = ledger.usersOf(activeWorkspace);
  const ownerId = activeMeta?.ownerUserId ?? "";
  const rateNotice = ledger.rateLimitNotice();

  if (convState.channel > 0) {
    return (
      <SlackChannelView
        workspaces={workspaces}
        conv={conv}
        composer={composer}
        ledger={ledger}
        users={users}
        ownerId={ownerId}
        rateNotice={rateNotice}
        liveNotices={liveNotices}
        noticeControls={noticeControls}
        onOpenThread={(threadTs) => {
          if (conv.can({ type: "openThread", threadTs })) void conv.send({ type: "openThread", threadTs });
          if (composer.can({ type: "openTarget", workspace: convState.workspace, channel: convState.channel, threadTs }, "Owner")) {
            void composer.send({ type: "openTarget", workspace: convState.workspace, channel: convState.channel, threadTs }, "Owner");
          }
        }}
        onCloseThread={() => {
          if (conv.can({ type: "closeThread" })) void conv.send({ type: "closeThread" });
          if (composer.can({ type: "openTarget", workspace: convState.workspace, channel: convState.channel, threadTs: 0 }, "Owner")) {
            void composer.send({ type: "openTarget", workspace: convState.workspace, channel: convState.channel, threadTs: 0 }, "Owner");
          }
        }}
        onCloseChannel={() => {
          if (conv.can({ type: "closeChannel" })) void conv.send({ type: "closeChannel" });
          if (composer.can({ type: "closeTarget" }, "Owner")) void composer.send({ type: "closeTarget" }, "Owner");
        }}
      />
    );
  }

  return (
    <SlackWorkspaceListView
      auth={auth}
      workspaces={workspaces}
      ledger={ledger}
      connectedMetas={connectedMetas}
      activeMeta={activeMeta}
      users={users}
      ownerId={ownerId}
      rateNotice={rateNotice}
      noticeControls={noticeControls}
      onOpenChannel={(workspace, channelNum, summary) => {
        const kind = summary ? convKindOf(summary) : "PublicChannel";
        if (conv.can({ type: "openChannel", workspace, channel: channelNum, kind, front: true })) {
          void conv.send({ type: "openChannel", workspace, channel: channelNum, kind, front: true });
        }
        if (composer.can({ type: "openTarget", workspace, channel: channelNum, threadTs: 0 }, "Owner")) {
          void composer.send({ type: "openTarget", workspace, channel: channelNum, threadTs: 0 }, "Owner");
        }
      }}
    />
  );
}
