export interface Note {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
}

export type NoteScope = 'global' | 'conversation'

export interface NotesState {
  scope: NoteScope
  conversationId: string
  globalNotes: Note[]
  conversationNotes: Note[]
  /** null = list view; string = editing note id; 'new' = new note */
  activeNoteId: string | null
  editingNoteId: string | null
  editTitle: string
  editBody: string
  loading: boolean
  saving: boolean
  error: string
}
