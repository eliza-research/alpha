import { WebPlugin } from '@capacitor/core';
import {createBrowserNoteDocuments,type NoteDocumentsPort} from '../../../../.eliza/client-features/plugins/plugin-notes/src/client/note-documents.ts';

/** `AlphaNoteDocuments` in the browser: the shared Notes document port (local file input and
 * downloads; nothing is uploaded) with Alpha's PDF file name fallback. */
export class BrowserNoteDocuments extends WebPlugin implements NoteDocumentsPort {
  private readonly port=createBrowserNoteDocuments({pdfFallback:'Alpha scan'});
  importText(){return this.port.importText();}
  exportPdf(input:{title:string;dataBase64:string}){return this.port.exportPdf(input);}
  exportText(input:{title:string;text:string}){return this.port.exportText(input);}
}
