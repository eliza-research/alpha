import {connectionController} from '../runtime/connection-ui';
import {createInlineModal} from '../runtime/inline-modal';
import {inputFiles, runFilePicker} from '../browser/file-picker';
import {intakeAttachmentFiles, CHAT_UPLOAD_ACCEPT, MAX_CHAT_IMAGES} from '../../../../.eliza/client-features/packages/ui/src/utils/image-attachment';

type Shell = Record<string, any>;

/** The composer uses the same file intake and message search as the main Eliza UI. */
export function installChatTools(Component: {prototype: Shell}) {
  const prototype = Component.prototype;
  const render = prototype.renderVals;
  const unmount = prototype.componentWillUnmount;
  const binding = () => JSON.stringify([
    connectionController.getSnapshot().session,
    connectionController.getSelectedConversationId(),
  ]);

  prototype.renderVals = function() {
    const output = render.call(this);
    const shell = this;
    const owner = JSON.stringify(connectionController.getSnapshot().session);
    if (this.chatToolsOwner !== owner) {
      this.chatSearchAbort?.abort();
      clearTimeout(this.chatSearchTimer);
      this.chatSearchOpen = false;
      this.chatSearchBusy = false;
      this.chatSearchResults = [];
      this.chatToolsOpen = false;
      this.chatToolsOwner = owner;
    }
    this.fileAttachments ??= [];
    const closeMenu = () => {shell.chatToolsOpen = false;shell.setState({});};
    const closeSearch = () => {
      shell.chatSearchAbort?.abort();
      clearTimeout(shell.chatSearchTimer);
      shell.chatSearchOpen = false;
      shell.chatSearchBusy = false;
      shell.setState({});
    };
    this.chatToolsModal ??= createInlineModal(closeMenu);
    this.chatSearchModal ??= createInlineModal(closeSearch);
    const upload = async () => {
      closeMenu();
      if (shell.draftSendPending || shell.composerDraft?.holding || shell.messageEditTarget) return;
      const owner = binding();
      shell.chatFileBusy = true;
      shell.setState({});
      const existing = shell.fileAttachments;
      try {
        const files = await runFilePicker(signal => inputFiles(signal, {
          multiple: true,
          accept: CHAT_UPLOAD_ACCEPT.split(',').filter(type => !/^(audio|video)\//.test(type)).join(','),
        }), []);
        if (!files.length || !shell.live || binding() !== owner) return;
        if (files.some(file => /^(audio|video)\//.test(file.type))) {
          throw Error('Choose a photo or document.');
        }
        const result = await intakeAttachmentFiles(files, {
          existingCount: existing.length + (shell.cameraAttachment ? 1 : 0),
        });
        if (result.droppedTooLarge.length || result.droppedOverCount.length || result.attachments.length !== files.length)
          throw Error(`Choose supported photos or documents, up to ${MAX_CHAT_IMAGES} attachments.`);
        if (!shell.live || binding() !== owner || shell.fileAttachments !== existing || shell.composerDraft?.holding) return;
        shell.fileAttachments = [...existing, ...result.attachments.map(file => ({...file, id:crypto.randomUUID()}))];
        shell.setState((state: Shell) => ({chat:'sheet', draft:String(state.draft||'').trim() ? state.draft : 'Summarize this for me'}));
      } catch (error) {
        if (shell.live && binding() === owner) shell.toast(error instanceof Error ? error.message : 'The attachment could not open.');
      } finally {if(shell.live){shell.chatFileBusy=false;shell.setState({});}}
    };
    const search = (append = false) => {
      shell.chatSearchAbort?.abort();
      const query = String(shell.chatSearchQuery || '').trim();
      if (query.length < 2) {shell.chatSearchResults = [];shell.chatSearchBusy = false;shell.setState({});return;}
      const abort = shell.chatSearchAbort = new AbortController();
      const owner = binding();
      shell.chatSearchBusy = true;
      shell.chatSearchError = '';
      shell.setState({});
      void connectionController.searchMessages(query, abort.signal, append ? (shell.chatSearchResults?.length || 0) : 0).then(results => {
        if (abort.signal.aborted || !shell.live || binding() !== owner || shell.chatSearchQuery.trim() !== query) return;
        shell.chatSearchResults = append ? [...shell.chatSearchResults, ...results] : results;
        shell.chatSearchMore = results.length === 50;
      }).catch(error => {
        if (!abort.signal.aborted && shell.live) shell.chatSearchError = error instanceof Error ? error.message : 'Search could not finish.';
      }).finally(() => {
        if (shell.chatSearchAbort === abort) {shell.chatSearchBusy = false;shell.setState({});}
      });
    };
    const openResult = async (result: Shell) => {
      const existing = document.querySelector<HTMLElement>(`[data-alpha-message-id="${CSS.escape(result.messageId)}"]`);
      if (!existing && (shell.fileAttachments.length || shell.cameraAttachment || shell.transcriptAttachment || shell.mailAttachment)) {
        shell.chatSearchError = 'Send or remove the attachment before changing chats.';
        shell.setState({});
        return;
      }
      const ownerSession = JSON.stringify(connectionController.getSnapshot().session);
      try {
        if (!existing) {
          await connectionController.restoreHistory(result.conversationId,
            () => shell.live && shell.chatSearchOpen && JSON.stringify(connectionController.getSnapshot().session) === ownerSession,
            result.messageId);
        }
        if (!shell.live || !shell.chatSearchOpen || JSON.stringify(connectionController.getSnapshot().session) !== ownerSession) return;
        if (connectionController.getSelectedConversationId() !== result.conversationId
          || !document.querySelector(`[data-alpha-message-id="${CSS.escape(result.messageId)}"]`)) {
          throw Error('This message could not be opened. Try the search again.');
        }
      } catch (error) {
        if (shell.live && shell.chatSearchOpen && JSON.stringify(connectionController.getSnapshot().session) === ownerSession) {
          shell.chatSearchError = error instanceof Error ? error.message : 'This message could not be opened.';
          shell.setState({});
        }
        return;
      }
      closeSearch();
      shell.setState({chat:'full'}, () => requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(`[data-alpha-message-id="${CSS.escape(result.messageId)}"]`);
        target?.scrollIntoView({block:'center',behavior:'smooth'});
        if (target) {target.classList.add('alpha-search-hit');setTimeout(() => target.classList.remove('alpha-search-hit'), 1800);}
      }));
    };
    output.chatTools = {
      open: !!this.chatToolsOpen,
      disabled: !!this.draftSendPending || !!this.composerDraft?.holding || !!this.S().typing || !!this.chatFileBusy,
      fileBusy:!!this.chatFileBusy,
      toggle: () => {shell.chatToolsOpen = !shell.chatToolsOpen;shell.setState({});},
      close: closeMenu,
      pointer:(event:Event)=>event.stopPropagation(),
      inside:(event:Event)=>event.stopPropagation(),
      ref: this.chatToolsModal.ref,
      upload: () => void upload(),
      search: () => {closeMenu();shell.chatSearchOpen = true;shell.chatSearchQuery = '';shell.chatSearchResults = [];shell.chatSearchMore = false;shell.chatSearchBusy = false;shell.chatSearchError = '';shell.setState({chat:'full'});},
    };
    output.chatSearch = {
      open: !!this.chatSearchOpen,
      query: this.chatSearchQuery || '',
      busy: !!this.chatSearchBusy,
      error: this.chatSearchError || '',
      ref: this.chatSearchModal.ref,
      close: closeSearch,
      inside:(event:Event)=>event.stopPropagation(),
      change: (event: Event) => {
        shell.chatSearchQuery = (event.target as HTMLInputElement).value;
        clearTimeout(shell.chatSearchTimer);
        shell.chatSearchAbort?.abort();
        shell.chatSearchBusy=shell.chatSearchQuery.trim().length>=2;
        shell.chatSearchTimer = setTimeout(() => search(), 250);
        shell.setState({});
      },
      rows: (this.chatSearchResults || []).map((result: Shell) => ({
        id:result.messageId, text:result.snippet || result.text,
        date:new Date(result.createdAt).toLocaleDateString(),
        go:() => {if(!shell.chatSearchBusy)void openResult(result);},
      })),
      more: !!this.chatSearchMore,
      loadMore: () => search(true),
    };
    output.attachedFiles = this.S().msgs.some((message: Shell) => message.fileAttachments === this.fileAttachments) ? [] : this.fileAttachments.map((file: Shell) => ({
      id:file.id, name:file.name, image:file.mimeType.startsWith('image/') ? `data:${file.mimeType};base64,${file.data}` : '',
      remove:() => {shell.fileAttachments = shell.fileAttachments.filter((item: Shell) => item.id !== file.id);shell.setState({});},
    }));
    return output;
  };
  prototype.componentWillUnmount = function(...args: unknown[]) {
    this.chatSearchAbort?.abort();clearTimeout(this.chatSearchTimer);
    this.chatToolsModal?.ref(null);this.chatSearchModal?.ref(null);
    return unmount?.apply(this,args);
  };
}
