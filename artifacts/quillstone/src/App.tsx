import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Search, Plus, ChevronDown, ChevronRight, FileText, Bold, Italic, Type,
  PanelLeftClose, PanelLeftOpen, Feather, Clock3, Target, Sparkles, BookMarked,
  StickyNote, Play, Pause, RotateCcw, Download, Maximize2, Minimize2, X,
  Trash2, Pencil, Link2, Check, ArrowUpRight, CalendarDays, CircleDot,
} from 'lucide-react';
import './index.css';

type Project = { id: string; title: string; genre: string; description: string; targetWords: number; dailyGoal: number; createdAt: string; updatedAt: string };
type ContentFormat = 'plain' | 'html';
type Document = { id: string; projectId: string; parentId: string | null; title: string; type: 'chapter' | 'scene'; content: string; contentFormat?: ContentFormat; order: number; status: string; updatedAt: string };
type ResearchNote = { id: string; projectId: string; title: string; body: string; tags: string[]; linkedDocumentIds: string[]; updatedAt: string };
type WritingSession = { id: string; projectId: string; startedAt: string; durationSeconds: number; wordsWritten: number };
type Thought = { id: string; projectId: string; content: string; kind: 'current' | 'another' | 'future' | 'needs-work'; documentId: string | null; sourceDocumentId: string; createdAt: string; resolvedAt: string | null };
type ThoughtMenuState = { x: number; y: number; text: string; sourceDocumentId: string; targetDocumentId: string; choosingTarget: boolean };
type Store = { version: number; activeProjectId: string; projects: Project[]; documents: Document[]; notes: ResearchNote[]; sessions: WritingSession[]; thoughts: Thought[] };
type ModalState =
  | { kind: 'document'; parentId?: string }
  | { kind: 'note'; noteId?: string }
  | { kind: 'project' };
const STORAGE_KEY = 'quillstone.studio.v1';

const seedStore = (): Store => {
  const now = new Date().toISOString(), pid = 'project-ember';
  const docs: Document[] = [
    { id: 'ch-1', projectId: pid, parentId: null, title: 'Part I — The Low Tide', type: 'chapter', content: '', order: 0, status: 'draft', updatedAt: now },
    { id: 'sc-1', projectId: pid, parentId: 'ch-1', title: 'The house at Bellwether', type: 'scene', content: 'The house had been listening for her longer than Mara had been away.\n\nSalt worried at the blue paint around the windows. Beyond the dunes, the North Sea pulled its grey blanket tight, then let it slip again. She stood at the gate with one hand on the rusted latch and the other around a key that no longer fit any lock she knew.\n\nA gull crossed the cloud seam. Somewhere inside, a floorboard answered.', order: 0, status: 'draft', updatedAt: now },
    { id: 'sc-2', projectId: pid, parentId: 'ch-1', title: 'A room kept for winter', type: 'scene', content: 'Inside, everything had the faint, careful smell of closed rooms. Her mother had left the kettle on the stove, though the last cup of tea must have cooled years ago.', order: 1, status: 'draft', updatedAt: now },
    { id: 'ch-2', projectId: pid, parentId: null, title: 'Part II — The Salt Archive', type: 'chapter', content: '', order: 1, status: 'draft', updatedAt: now },
    { id: 'sc-3', projectId: pid, parentId: 'ch-2', title: 'Names in the ledger', type: 'scene', content: '', order: 0, status: 'draft', updatedAt: now },
  ];
  return {
    version: 1,
    activeProjectId: pid,
    projects: [{ id: pid, title: 'The Quiet Between Tides', genre: 'Literary fiction', description: 'A daughter returns to a house that remembers what she cannot.', targetWords: 80000, dailyGoal: 750, createdAt: now, updatedAt: now }],
    documents: docs,
    notes: [
      { id: 'note-1', projectId: pid, title: 'Bellwether — tide table', body: 'Spring tides reach the harbor wall around 06:40. At the lowest ebb, the old steps reappear beneath the east pier.', tags: ['setting', 'research'], linkedDocumentIds: ['sc-1'], updatedAt: now },
      { id: 'note-2', projectId: pid, title: 'Mara, age 34', body: 'Keeps the names of birds in the margins of books. Left home at nineteen. Returns with the habit of measuring every silence.', tags: ['character'], linkedDocumentIds: ['sc-1', 'sc-2'], updatedAt: now },
    ],
    sessions: [],
    thoughts: [],
  };
};
function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { const fresh = seedStore(); localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); return fresh; }
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.projects) && parsed.projects.length > 0 &&
      typeof parsed.projects[0]?.id === 'string' && typeof parsed.projects[0]?.title === 'string' &&
      Number.isFinite(parsed.projects[0]?.targetWords) && Number.isFinite(parsed.projects[0]?.dailyGoal) &&
      Array.isArray(parsed.documents) && Array.isArray(parsed.notes) && Array.isArray(parsed.sessions)) {
      const activeProjectId = parsed.projects.some((p: Project) => p.id === parsed.activeProjectId)
        ? parsed.activeProjectId
        : parsed.projects[0].id;
      const thoughts = Array.isArray(parsed.thoughts)
        ? parsed.thoughts.map((thought: Thought) => ({ ...thought, resolvedAt: thought.resolvedAt ?? null }))
        : [];
      return { ...parsed, activeProjectId, thoughts } as Store;
    }
  } catch { /* recover with a clean, valid local workspace */ }
  const fresh = seedStore();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); } catch { /* storage may be unavailable */ }
  return fresh;
}
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
function sanitizeRichHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const allowedTags = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'SPAN']);
  const clean = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(node.textContent ?? '')];
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const source = node as HTMLElement;
    const children = Array.from(source.childNodes).flatMap(clean);
    if (!allowedTags.has(source.tagName)) return children;
    const safe = document.createElement(source.tagName.toLowerCase());
    if (source.tagName === 'SPAN') {
      if (['14px', '16px', '20px', '24px'].includes(source.style.fontSize)) safe.style.fontSize = source.style.fontSize;
      if (['bold', '700'].includes(source.style.fontWeight)) safe.style.fontWeight = 'bold';
      if (source.style.fontStyle === 'italic') safe.style.fontStyle = 'italic';
      if (source.dataset.needsWorkId) {
        safe.dataset.needsWorkId = source.dataset.needsWorkId;
        safe.style.fontStyle = 'italic';
      }
    }
    children.forEach(child => safe.appendChild(child));
    return [safe];
  };
  const result = document.createElement('div');
  Array.from(parsed.body.childNodes).flatMap(clean).forEach(node => result.appendChild(node));
  return result.innerHTML;
}
function toEditorHtml(content: string, format?: ContentFormat): string {
  if (format === 'html') return sanitizeRichHtml(content);
  if (!content) return '';
  return content.split(/\n{2,}/).map(paragraph => `<p>${paragraph.split('\n').map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>')}</p>`).join('');
}
function contentToText(content: string, format?: ContentFormat, markdown = false): string {
  if (format !== 'html') return content;
  const root = document.createElement('div');
  root.innerHTML = sanitizeRichHtml(content);
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as HTMLElement;
    const children = Array.from(element.childNodes).map(visit).join('');
    if (element.tagName === 'BR') return '\n';
    if (markdown && (['B', 'STRONG'].includes(element.tagName) || element.style.fontWeight === 'bold')) return `**${children}**`;
    if (markdown && (['I', 'EM'].includes(element.tagName) || element.style.fontStyle === 'italic')) return `*${children}*`;
    if (['P', 'DIV'].includes(element.tagName)) return `${children}\n\n`;
    return children;
  };
  return Array.from(root.childNodes).map(visit).join('').replace(/\n{3,}/g, '\n\n').trim();
}
function wrapTextRange(editor: HTMLElement, range: Range, createWrapper: (text: string) => HTMLElement): string | null {
  if (!editor.contains(range.commonAncestorContainer)) return null;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; start: number; end: number }[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start < end) segments.push({ node, start, end });
  }
  if (!segments.length) return null;
  segments.forEach(({ node, start, end }) => {
    if (!node.parentNode) return;
    const fragment = document.createDocumentFragment();
    if (start > 0) fragment.appendChild(document.createTextNode(node.data.slice(0, start)));
    const wrapper = createWrapper(node.data.slice(start, end));
    fragment.appendChild(wrapper);
    if (end < node.length) fragment.appendChild(document.createTextNode(node.data.slice(end)));
    node.parentNode.replaceChild(fragment, node);
  });
  return editor.innerHTML;
}
function removeNeedsWorkMarks(content: string, thoughtId: string): string {
  const root = document.createElement('div');
  root.innerHTML = sanitizeRichHtml(content);
  root.querySelectorAll('[data-needs-work-id]').forEach(mark => {
    if ((mark as HTMLElement).dataset.needsWorkId !== thoughtId) return;
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
  });
  return root.innerHTML;
}
const wordCount = (value: string, format?: ContentFormat) => {
  const text = contentToText(value, format).trim();
  return text ? text.split(/\s+/).length : 0;
};
const shortDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export default function App() {
  const [store, setStore] = useState<Store>(readStore);
  const [selectedId, setSelectedId] = useState('sc-1');
  const [expanded, setExpanded] = useState<string[]>(['ch-1', 'ch-2']);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'desk' | 'research' | 'thoughts' | 'search' | 'history'>('desk');
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [thoughtMenu, setThoughtMenu] = useState<ThoughtMenuState | null>(null);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [thoughtPanelMode, setThoughtPanelMode] = useState<'thoughts' | 'needsWork'>('thoughts');
  const [timerOn, setTimerOn] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [sessionWords, setSessionWords] = useState(0);
  const sessionStart = useRef<string | null>(null);
  const projectSwitchRef = useRef<HTMLDivElement>(null);
  const formatControlRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const thoughtSelectionRef = useRef<Range | null>(null);
  const formatSelectionRef = useRef<Range | null>(null);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { setNotice('Local storage is unavailable; changes may not persist.'); } }, [store]);
  useEffect(() => {
    if (!timerOn) return;
    const id = window.setInterval(() => { setTimerSeconds(s => Math.max(0, s - 1)); setSessionSeconds(s => s + 1); }, 1000);
    return () => window.clearInterval(id);
  }, [timerOn]);
  useEffect(() => {
    if (rightTab !== 'search') return;
    const id = window.requestAnimationFrame(() => document.getElementById('global-search')?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [rightTab]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setRightTab('search');
      }
      if (event.key === 'Escape' && focus) setFocus(false);
      if (event.key === 'Escape' && projectMenuOpen) setProjectMenuOpen(false);
      if (event.key === 'Escape' && thoughtMenu) { setThoughtMenu(null); thoughtSelectionRef.current = null; }
      if (event.key === 'Escape' && formatMenuOpen) setFormatMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focus, projectMenuOpen, thoughtMenu, formatMenuOpen]);
  useEffect(() => {
    if (!projectMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !projectSwitchRef.current?.contains(event.target)) setProjectMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [projectMenuOpen]);
  useEffect(() => {
    if (!formatMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !formatControlRef.current?.contains(event.target)) setFormatMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [formatMenuOpen]);
  useEffect(() => { if (timerOn && timerSeconds === 0) finishSession(); }, [timerOn, timerSeconds]);
  useEffect(() => {
    if (!notice) return undefined;
    const id = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(id);
  }, [notice]);

  const project = store.projects.find(p => p.id === store.activeProjectId) ?? store.projects[0];
  const docs = useMemo(() => store.documents.filter(d => d.projectId === project.id).sort((a, b) => a.order - b.order), [store.documents, project.id]);
  const notes = useMemo(() => store.notes.filter(n => n.projectId === project.id), [store.notes, project.id]);
  const sessions = useMemo(() => store.sessions.filter(s => s.projectId === project.id), [store.sessions, project.id]);
  const thoughts = useMemo(() => store.thoughts.filter(t => t.projectId === project.id), [store.thoughts, project.id]);
  const noteThoughts = useMemo(() => thoughts.filter(t => t.kind !== 'needs-work'), [thoughts]);
  const needsWorkThoughts = useMemo(() => thoughts.filter(t => t.kind === 'needs-work'), [thoughts]);
  const openWorkItems = useMemo(() => needsWorkThoughts.filter(t => !t.resolvedAt), [needsWorkThoughts]);
  const solvedWorkItems = useMemo(() => needsWorkThoughts.filter(t => !!t.resolvedAt), [needsWorkThoughts]);
  const selected = docs.find(d => d.id === selectedId) ?? docs.find(d => d.type === 'scene') ?? docs[0];
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) editor.innerHTML = toEditorHtml(selected?.content ?? '', selected?.contentFormat);
    thoughtSelectionRef.current = null;
    formatSelectionRef.current = null;
  }, [selected?.id]);
  const scenes = docs.filter(d => d.type === 'scene');
  const pageThoughts = useMemo(() => noteThoughts.filter(t => t.documentId === selected?.id), [noteThoughts, selected?.id]);
  const futureThoughts = useMemo(() => thoughts.filter(t => t.kind === 'future'), [thoughts]);
  const allWords = scenes.reduce((n, d) => n + wordCount(d.content, d.contentFormat), 0);
  const todaySessions = sessions.filter(s => new Date(s.startedAt).toDateString() === new Date().toDateString());
  const todayWords = todaySessions.reduce((n, s) => n + s.wordsWritten, 0) + sessionWords;
  const linkedNotes = notes.filter(n => selected && n.linkedDocumentIds.includes(selected.id));

  const patchStore = useCallback((fn: (prev: Store) => Store) => setStore(prev => fn(prev)), []);
  const updateProjectGoals = (changes: Partial<Pick<Project, 'targetWords' | 'dailyGoal'>>) => {
    patchStore(s => ({
      ...s,
      projects: s.projects.map(p => p.id === project.id ? { ...p, ...changes, updatedAt: new Date().toISOString() } : p),
    }));
  };
  const updateContent = (value: string) => {
    if (!selected) return;
    const previous = wordCount(selected.content, selected.contentFormat);
    patchStore(s => ({ ...s, documents: s.documents.map(d => d.id === selected.id ? { ...d, content: value, contentFormat: 'html', updatedAt: new Date().toISOString() } : d) }));
    if (timerOn) setSessionWords(n => n + Math.max(0, wordCount(value, 'html') - previous));
  };
  const applyInlineFormat = (command: 'bold' | 'italic') => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.isCollapsed || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      setNotice('Select text in the manuscript before applying a format.');
      return;
    }
    editor.focus();
    document.execCommand(command, false);
    updateContent(editor.innerHTML);
  };
  const applyFontSize = (size: number) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const range = formatSelectionRef.current ?? (selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null);
    if (!editor || !range || range.collapsed) {
      setNotice('Select text in the manuscript before changing its size.');
      return;
    }
    const html = wrapTextRange(editor, range, text => {
      const span = document.createElement('span');
      span.style.fontSize = `${size}px`;
      span.textContent = text;
      return span;
    });
    if (!html) {
      setNotice('Select text in the manuscript before changing its size.');
      return;
    }
    formatSelectionRef.current = null;
    updateContent(html);
  };
  const addDocument = (title: string, type: 'chapter' | 'scene', parentId?: string) => {
    const parent = parentId ?? null;
    const siblingCount = docs.filter(d => d.parentId === parent).length;
    const newDoc: Document = { id: uid(), projectId: project.id, parentId: parent, title, type, content: '', order: siblingCount, status: 'draft', updatedAt: new Date().toISOString() };
    patchStore(s => ({ ...s, documents: [...s.documents, newDoc] }));
    if (type === 'chapter') setExpanded(v => [...v, newDoc.id]);
    setSelectedId(newDoc.id); setModal(null); setNotice(`${type === 'chapter' ? 'Chapter' : 'Scene'} added to your binder.`);
  };
  const renameDoc = (doc: Document) => {
    const title = window.prompt('Give this section a new title', doc.title);
    if (title?.trim()) { patchStore(s => ({ ...s, documents: s.documents.map(d => d.id === doc.id ? { ...d, title: title.trim(), updatedAt: new Date().toISOString() } : d) })); setNotice('Title updated.'); }
  };
  const deleteDoc = (doc: Document) => {
    if (!window.confirm(`Delete “${doc.title}” and its contents? This cannot be undone.`)) return;
    const removed = new Set([doc.id, ...docs.filter(d => d.parentId === doc.id).map(d => d.id)]);
    patchStore(s => ({ ...s, documents: s.documents.filter(d => !removed.has(d.id)), notes: s.notes.map(n => ({ ...n, linkedDocumentIds: n.linkedDocumentIds.filter(id => !removed.has(id)) })), thoughts: s.thoughts.filter(t => !t.documentId || !removed.has(t.documentId)) }));
    if (removed.has(selectedId)) setSelectedId(docs.find(d => !removed.has(d.id) && d.type === 'scene')?.id ?? '');
    setNotice('Section removed from the binder.');
  };
  const moveDoc = (doc: Document, direction: -1 | 1) => {
    const siblings = docs.filter(d => d.parentId === doc.parentId).sort((a,b)=>a.order-b.order), index = siblings.findIndex(d => d.id === doc.id), swap = siblings[index + direction];
    if (!swap) return;
    patchStore(s => ({ ...s, documents: s.documents.map(d => d.id === doc.id ? { ...d, order: swap.order } : d.id === swap.id ? { ...d, order: doc.order } : d) }));
  };
  const saveNote = (title: string, body: string, tags: string, noteId?: string) => {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    patchStore(s => {
      if (noteId) return { ...s, notes: s.notes.map(n => n.id === noteId ? { ...n, title, body, tags: tagList, updatedAt: new Date().toISOString() } : n) };
      return { ...s, notes: [{ id: uid(), projectId: project.id, title, body, tags: tagList, linkedDocumentIds: selected ? [selected.id] : [], updatedAt: new Date().toISOString() }, ...s.notes] };
    });
    setModal(null); setNotice(noteId ? 'Reference updated.' : 'Reference filed in your research desk.');
  };
  const toggleLink = (noteId: string, docId: string) => patchStore(s => ({ ...s, notes: s.notes.map(n => n.id === noteId ? { ...n, linkedDocumentIds: n.linkedDocumentIds.includes(docId) ? n.linkedDocumentIds.filter(id => id !== docId) : [...n.linkedDocumentIds, docId] } : n) }));
  const saveThought = (kind: Thought['kind'], targetDocumentId?: string) => {
    if (!thoughtMenu) return;
    const documentId = kind === 'current' || kind === 'needs-work'
      ? thoughtMenu.sourceDocumentId
      : kind === 'another' ? targetDocumentId ?? thoughtMenu.targetDocumentId : null;
    if (kind === 'another' && !documentId) return;
    const createdAt = new Date().toISOString();
    const thought: Thought = {
      id: uid(),
      projectId: project.id,
      content: thoughtMenu.text,
      kind,
      documentId,
      sourceDocumentId: thoughtMenu.sourceDocumentId,
      createdAt,
      resolvedAt: null,
    };
    let markedContent: string | null = null;
    if (kind === 'needs-work') {
      const editor = editorRef.current;
      const range = thoughtSelectionRef.current;
      if (!editor || !range || selected?.id !== thoughtMenu.sourceDocumentId) {
        setNotice('Select the passage again before marking it for work.');
        return;
      }
      markedContent = wrapTextRange(editor, range, text => {
        const marker = document.createElement('span');
        marker.dataset.needsWorkId = thought.id;
        marker.style.fontStyle = 'italic';
        marker.textContent = text;
        return marker;
      });
      if (markedContent === null) {
        setNotice('Select the passage again before marking it for work.');
        return;
      }
    }
    patchStore(s => ({
      ...s,
      thoughts: [thought, ...s.thoughts],
      documents: markedContent === null ? s.documents : s.documents.map(d => d.id === thoughtMenu.sourceDocumentId ? { ...d, content: markedContent!, contentFormat: 'html', updatedAt: createdAt } : d),
    }));
    setThoughtMenu(null);
    setRightTab('thoughts');
    setThoughtPanelMode(kind === 'needs-work' ? 'needsWork' : 'thoughts');
    thoughtSelectionRef.current = null;
    setNotice(kind === 'current' ? 'Thought saved to this page.' : kind === 'another' ? 'Thought saved to the selected page.' : kind === 'needs-work' ? 'Passage marked for work. It will stay italic until solved.' : 'Thought saved for the future.');
  };
  const solveThought = (thoughtId: string) => {
    const thought = thoughts.find(t => t.id === thoughtId && t.kind === 'needs-work');
    if (!thought || thought.resolvedAt) return;
    const sourceDocument = store.documents.find(d => d.id === thought.documentId);
    const updatedContent = sourceDocument?.contentFormat === 'html' ? removeNeedsWorkMarks(sourceDocument.content, thoughtId) : sourceDocument?.content;
    const resolvedAt = new Date().toISOString();
    patchStore(s => ({
      ...s,
      thoughts: s.thoughts.map(t => t.id === thoughtId ? { ...t, resolvedAt } : t),
      documents: updatedContent === undefined ? s.documents : s.documents.map(d => d.id === thought.documentId ? { ...d, content: updatedContent, updatedAt: resolvedAt } : d),
    }));
    if (thought.documentId === selected?.id && editorRef.current && updatedContent !== undefined) editorRef.current.innerHTML = toEditorHtml(updatedContent, sourceDocument?.contentFormat);
    setNotice('Marked solved. The italics were removed.');
  };
  const deleteThought = (thoughtId: string) => {
    const thought = thoughts.find(t => t.id === thoughtId);
    const sourceDocument = thought?.kind === 'needs-work' && !thought.resolvedAt ? store.documents.find(d => d.id === thought.documentId) : undefined;
    const updatedContent = sourceDocument?.contentFormat === 'html' ? removeNeedsWorkMarks(sourceDocument.content, thoughtId) : sourceDocument?.content;
    patchStore(s => ({
      ...s,
      thoughts: s.thoughts.filter(t => t.id !== thoughtId),
      documents: updatedContent === undefined ? s.documents : s.documents.map(d => d.id === thought?.documentId ? { ...d, content: updatedContent, updatedAt: new Date().toISOString() } : d),
    }));
    if (thought?.documentId === selected?.id && editorRef.current && updatedContent !== undefined) editorRef.current.innerHTML = toEditorHtml(updatedContent, sourceDocument?.contentFormat);
    setNotice(thought?.kind === 'needs-work' && !thought.resolvedAt ? 'Work item removed and italics cleared.' : 'Thought removed.');
  };
  const finishSession = () => {
    setTimerOn(false);
    if (sessionSeconds > 0 || sessionWords > 0) {
      patchStore(s => ({ ...s, sessions: [{ id: uid(), projectId: project.id, startedAt: sessionStart.current ?? new Date().toISOString(), durationSeconds: sessionSeconds, wordsWritten: sessionWords }, ...s.sessions] }));
      setNotice(`Session saved · ${sessionWords} ${sessionWords === 1 ? 'word' : 'words'} written.`);
    }
    setSessionSeconds(0); setSessionWords(0); setTimerSeconds(25 * 60); sessionStart.current = null;
  };
  const startPauseTimer = () => {
    if (timerOn) setTimerOn(false);
    else { if (!sessionStart.current) sessionStart.current = new Date().toISOString(); setTimerOn(true); }
  };
  const resetTimer = () => { setTimerOn(false); setTimerSeconds(25 * 60); setSessionSeconds(0); setSessionWords(0); sessionStart.current = null; };
  const switchProject = (projectId: string) => {
    const nextProject = store.projects.find(p => p.id === projectId);
    if (!nextProject) return;
    setProjectMenuOpen(false);
    if (nextProject.id === project.id) return;
    finishSession();
    const nextDocs = store.documents.filter(d => d.projectId === projectId).sort((a, b) => a.order - b.order);
    setSelectedId(nextDocs.find(d => d.type === 'scene')?.id ?? nextDocs[0]?.id ?? '');
    setExpanded(nextDocs.filter(d => d.type === 'chapter').map(d => d.id));
    setRightTab('desk');
    setQuery('');
    setFocus(false);
    patchStore(s => ({ ...s, activeProjectId: projectId }));
    setNotice(`Switched to “${nextProject.title}”.`);
  };
  const openNewProject = () => {
    setProjectMenuOpen(false);
    setModal({ kind: 'project' });
  };
  const createProject = (title: string) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setNotice('Enter a title for the new novel.');
      return;
    }
    finishSession();
    const now = new Date().toISOString();
    const newProject: Project = {
      id: uid(),
      title: cleanTitle,
      genre: 'Novel',
      description: '',
      targetWords: 80000,
      dailyGoal: 750,
      createdAt: now,
      updatedAt: now,
    };
    patchStore(s => ({ ...s, projects: [...s.projects, newProject], activeProjectId: newProject.id }));
    setSelectedId('');
    setExpanded([]);
    setRightTab('desk');
    setQuery('');
    setFocus(false);
    setProjectMenuOpen(false);
    setModal(null);
    setNotice(`“${cleanTitle}” is ready. Add your first chapter to begin.`);
  };
  const exportFile = (format: 'txt' | 'md') => {
    const body = docs.filter(d => d.type === 'chapter').map(ch => {
      const children = docs.filter(d => d.parentId === ch.id);
      const chapterContent = contentToText(ch.content, ch.contentFormat, format === 'md');
      const scenesAndText = children.map(scene => `${format === 'md' ? `## ${scene.title}` : scene.title}\n\n${contentToText(scene.content, scene.contentFormat, format === 'md')}`).join('\n\n');
      return `${format === 'md' ? `# ${ch.title}` : ch.title.toUpperCase()}\n\n${chapterContent}${chapterContent && scenesAndText ? '\n\n' : ''}${scenesAndText}`;
    }).join('\n\n---\n\n');
    const blob = new Blob([`${format === 'md' ? `# ${project.title}\n\n` : `${project.title}\n${'='.repeat(project.title.length)}\n\n`}${body}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${format}`; a.click(); URL.revokeObjectURL(url); setNotice(`Manuscript exported as .${format}.`);
  };
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [
      ...docs.filter(d => `${d.title} ${contentToText(d.content, d.contentFormat)}`.toLowerCase().includes(q)).map(d => ({ id: d.id, kind: d.type, title: d.title, excerpt: contentToText(d.content, d.contentFormat) || 'No manuscript text yet.', onClick: () => { setSelectedId(d.id); setRightTab('desk'); } })),
      ...notes.filter(n => `${n.title} ${n.body} ${n.tags.join(' ')}`.toLowerCase().includes(q)).map(n => ({ id: n.id, kind: 'reference', title: n.title, excerpt: n.body, onClick: () => setRightTab('research') })),
    ];
  }, [query, docs, notes]);
  const progress = Math.min(100, project.targetWords ? Math.round(allWords / project.targetWords * 100) : 0);
  const thoughtMenuDocuments = thoughtMenu ? docs.filter(d => d.id !== thoughtMenu.sourceDocumentId) : [];

  return (
    <main className={`studio ${focus ? 'focus-mode' : ''}`} data-testid="studio-workspace">
      {!focus && <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="brand-row"><div className="brand-mark"><Feather size={17}/></div>{!collapsed && <span className="brand-name">quillstone</span>}<button className="icon-btn sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} data-testid="button-toggle-sidebar" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={16}/> : <PanelLeftClose size={16}/>}</button></div>
        {!collapsed && <>
          <div className="project-switch" ref={projectSwitchRef}>
            <span className="eyebrow">YOUR WORKROOM</span>
            <button className="project-select" type="button" aria-haspopup="menu" aria-expanded={projectMenuOpen} data-testid="button-project-menu" onClick={() => setProjectMenuOpen(open => !open)}>
              <span className="project-dot"/><span>{project.title}</span><ChevronDown size={14}/>
            </button>
            {projectMenuOpen && <div className="project-menu" role="menu" aria-label="Switch novel">
              {store.projects.map(p => <button className={`project-option ${p.id === project.id ? 'current' : ''}`} type="button" role="menuitem" aria-current={p.id === project.id ? 'page' : undefined} key={p.id} data-testid={`button-project-option-${p.id}`} onClick={() => switchProject(p.id)}>
                <span className="project-option-dot"/><span className="project-option-copy"><b>{p.title}</b><small>{p.id === project.id ? 'Current novel' : p.genre}</small></span>{p.id === project.id && <Check size={14}/>}
              </button>)}
              <div className="project-menu-divider"/>
              <button className="project-option project-option-create" type="button" role="menuitem" data-testid="menu-create-new-novel" onClick={openNewProject}>
                <Plus size={14}/><span className="project-option-copy"><b>New novel</b><small>Start a separate workroom</small></span>
              </button>
            </div>}
            <button className="new-project-button" type="button" data-testid="button-create-novel" onClick={openNewProject}><Plus size={13}/> New novel</button>
            <span className="project-meta">{project.genre} · {docs.length} {docs.length === 1 ? 'section' : 'sections'}</span>
          </div>
          <div className="nav-label">MANUSCRIPT</div>
          <div className="binder-head"><span className="eyebrow">BINDER</span><div className="tiny-actions"><button title="Add chapter" aria-label="Add chapter" data-testid="button-add-chapter" onClick={() => setModal({kind:'document'})}><Plus size={15}/></button><button title="Add scene" aria-label="Add scene" data-testid="button-add-scene" onClick={() => setModal({kind:'document', parentId: selected?.type === 'chapter' ? selected.id : selected?.parentId ?? undefined})}><FileText size={14}/></button></div></div>
          <div className="binder-tree" role="tree" aria-label="Manuscript binder">
            {docs.filter(d => d.type === 'chapter').map(ch => <div key={ch.id} className="chapter-group">
              <div className={`tree-row chapter-row ${selectedId === ch.id ? 'selected' : ''}`} data-testid={`tree-document-${ch.id}`}>
                <button className="tree-main" role="treeitem" aria-expanded={expanded.includes(ch.id)} onClick={() => { setExpanded(e => e.includes(ch.id) ? e.filter(id => id !== ch.id) : [...e, ch.id]); setSelectedId(ch.id); }}><span className="tree-chevron">{expanded.includes(ch.id) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</span><BookOpen size={14}/><span className="tree-title">{ch.title}</span></button>
                <div className="row-actions"><button aria-label={`Rename ${ch.title}`} data-testid={`button-rename-${ch.id}`} onClick={() => renameDoc(ch)}><Pencil size={12}/></button><button aria-label={`Delete ${ch.title}`} data-testid={`button-delete-${ch.id}`} onClick={() => deleteDoc(ch)}><Trash2 size={12}/></button></div>
              </div>
              {expanded.includes(ch.id) && docs.filter(d => d.parentId === ch.id).map(scene => <div key={scene.id} className={`tree-row scene-row ${selectedId === scene.id ? 'selected' : ''}`} data-testid={`tree-document-${scene.id}`}>
                <button className="tree-main" role="treeitem" onClick={() => setSelectedId(scene.id)}><span className="scene-marker"/><span className="tree-title">{scene.title}</span></button>
                <div className="row-actions">
                  <button aria-label={`Move ${scene.title} up`} data-testid={`button-move-up-${scene.id}`} onClick={() => moveDoc(scene,-1)}>↑</button><button aria-label={`Move ${scene.title} down`} data-testid={`button-move-down-${scene.id}`} onClick={() => moveDoc(scene,1)}>↓</button>
                  <button aria-label={`Rename ${scene.title}`} data-testid={`button-rename-${scene.id}`} onClick={() => renameDoc(scene)}><Pencil size={12}/></button><button aria-label={`Delete ${scene.title}`} data-testid={`button-delete-${scene.id}`} onClick={() => deleteDoc(scene)}><Trash2 size={12}/></button>
                </div>
              </div>)}
              <button className="add-scene-inline" data-testid={`button-add-scene-${ch.id}`} onClick={() => setModal({kind:'document', parentId:ch.id})}><Plus size={12}/> Add scene</button>
            </div>)}
            {!docs.length && <div className="empty-binder"><BookMarked size={20}/><span>Your binder is waiting for its first chapter.</span><button onClick={() => setModal({kind:'document'})}>Add a chapter</button></div>}
          </div>
          <div className="sidebar-bottom">
            <div className="goal-card"><div className="goal-title"><Target size={15}/><span>BOOK GOAL</span><button aria-label="Edit book goal" data-testid="button-edit-goal" onClick={() => { const v = window.prompt('Project word goal', String(project.targetWords)); if (v && Number(v) > 0) updateProjectGoals({targetWords:Number(v)}); }}>···</button></div><div className="goal-numbers"><strong>{allWords.toLocaleString()}</strong><span>/ {project.targetWords.toLocaleString()}</span></div><div className="progress-track"><i style={{width:`${progress}%`}}/></div><div className="goal-foot"><span>{progress}% of the way</span><span>BOOK</span></div></div>
            <div className="daily-mini"><span className="daily-icon"><Sparkles size={15}/></span><div><b>Today’s intention</b><small>{todayWords.toLocaleString()} / {project.dailyGoal.toLocaleString()} words</small></div><button aria-label="Edit daily goal" data-testid="button-edit-daily-goal" onClick={() => { const v = window.prompt('Daily word goal', String(project.dailyGoal)); if (v && Number(v) > 0) updateProjectGoals({dailyGoal:Number(v)}); }}><Pencil size={12}/></button></div>
          </div>
        </>}
        {collapsed && <div className="collapsed-tools"><button title="Add chapter" aria-label="Add chapter" data-testid="button-add-chapter-collapsed" onClick={() => setModal({kind:'document'})}><Plus size={17}/></button><button title="Create a new novel" aria-label="Create a new novel" data-testid="button-create-novel-collapsed" onClick={openNewProject}><BookMarked size={17}/></button><button title="Research desk" aria-label="Research desk" onClick={() => setRightTab('research')}><StickyNote size={17}/></button></div>}
      </aside>}
      <section className="work-area">
        {!focus && <header className="topbar">
          <div className="crumbs"><span>WORKROOM</span><span className="crumb-slash">/</span><span className="crumb-project">{project.title}</span><span className="crumb-slash">/</span><b>{selected?.title ?? 'Start a chapter'}</b></div>
          <div className="topbar-actions">
            <div className="mobile-project-controls">
              <label className="sr-only" htmlFor="mobile-project-select">Switch novel</label>
              <select id="mobile-project-select" value={project.id} onChange={event => switchProject(event.target.value)} data-testid="select-mobile-project" aria-label="Switch novel">{store.projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
              <button type="button" title="Create a new novel" aria-label="Create a new novel" data-testid="button-create-novel-mobile" onClick={openNewProject}><Plus size={15}/></button>
            </div>
            <button className="search-trigger" data-testid="button-open-search" onClick={() => { setRightTab('search'); document.getElementById('global-search')?.focus(); }}><Search size={15}/><span>Search project</span><kbd>⌘ K</kbd></button><div className="saved-state"><span className="saved-dot"/><span>All changes saved</span></div><button className="icon-btn focus-trigger" title={focus ? 'Exit focus mode' : 'Enter focus mode'} data-testid="button-focus-mode" onClick={() => setFocus(!focus)}><Maximize2 size={16}/></button>
          </div>
        </header>}
        {focus && <div className="focus-bar"><span className="focus-brand"><Feather size={15}/> Quillstone</span><span className="focus-status">A quiet room for the next sentence</span><button className="focus-exit" onClick={() => setFocus(false)} data-testid="button-exit-focus"><Minimize2 size={15}/> Exit focus</button></div>}
        <div className="workspace-grid">
          <section className="editor-column">
            <div className="editor-context">
              {!focus && <div className="context-kicker"><span className="status-dot"/>{selected ? selected.type === 'chapter' ? 'CHAPTER' : 'SCENE' : 'NEW NOVEL'} <span className="context-divider">·</span> {selected ? 'DRAFT' : 'READY'}</div>}
              <div className="editor-tools">
                {!focus && <span className="autosave-label">Saved locally</span>}
                <div className="format-control" ref={formatControlRef}>
                  <button type="button" className={`icon-btn format-trigger ${formatMenuOpen ? 'is-open' : ''}`} title="Text formatting" aria-label="Open text formatting menu" aria-expanded={formatMenuOpen} disabled={!selected} data-testid="button-open-format-menu" onMouseDown={event => event.preventDefault()} onClick={() => setFormatMenuOpen(open => !open)}><Type size={16}/></button>
                  {formatMenuOpen && <div className="format-popover" role="toolbar" aria-label="Text formatting menu" data-testid="menu-text-formatting">
                    <span className="format-popover-label">FORMAT SELECTION</span>
                    <div className="format-action-row">
                      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => applyInlineFormat('bold')} data-testid="button-format-bold"><Bold size={14}/><span>Bold</span></button>
                      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => applyInlineFormat('italic')} data-testid="button-format-italic"><Italic size={14}/><span>Italic</span></button>
                    </div>
                    <label className="format-size-control" htmlFor="select-format-size"><span>Text size</span>
                      <select id="select-format-size" defaultValue="16" onMouseDown={() => {
                        const selection = window.getSelection();
                        formatSelectionRef.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
                      }} onChange={event => applyFontSize(Number(event.target.value))} data-testid="select-format-size">
                        <option value="14">Small · 14 px</option><option value="16">Regular · 16 px</option><option value="20">Large · 20 px</option><option value="24">Extra large · 24 px</option>
                      </select>
                    </label>
                  </div>}
                </div>
                {!focus && <button type="button" className="icon-btn" title="Focus mode" aria-label="Focus mode" onClick={() => setFocus(true)} data-testid="button-editor-focus"><Maximize2 size={15}/></button>}
              </div>
            </div>
            <div className="manuscript-page" data-testid="manuscript-editor">
              {selected && !focus && <><input className="manuscript-title" aria-label="Section title" data-testid="input-document-title" value={selected.title} onChange={e => patchStore(s => ({...s,documents:s.documents.map(d=>d.id===selected.id?{...d,title:e.target.value,updatedAt:new Date().toISOString()}:d)}))} placeholder="Name this section"/><div className="title-rule"/></>}
              {!selected && <div className="empty-manuscript-start" data-testid="empty-project-start"><span className="empty-start-mark"><BookMarked size={24}/></span><span className="empty-start-kicker">NEW NOVEL READY</span><h2>{project.title}</h2><p>Your workroom is ready. Add a chapter to begin writing; its binder, notes, and goals are separate from your other novels.</p><button type="button" onClick={() => setModal({kind:'document'})} data-testid="button-start-first-chapter"><Plus size={14}/> Add first chapter</button></div>}
              {selected && <div
                ref={editorRef}
                className="manuscript-input"
                role="textbox"
                aria-label="Manuscript text"
                aria-multiline="true"
                contentEditable={!!selected}
                suppressContentEditableWarning
                data-testid="input-manuscript"
                data-placeholder={selected ? 'The first sentence is yours to find…' : 'Add a chapter to the binder to start writing.'}
                onInput={event => updateContent(event.currentTarget.innerHTML)}
                onPaste={event => {
                  if (!selected) return;
                  event.preventDefault();
                  document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
                  updateContent(event.currentTarget.innerHTML);
                }}
                onContextMenu={event => {
                  if (!selected) return;
                  const selection = window.getSelection();
                  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
                  const text = range?.toString().trim() ?? '';
                  if (!range || !text || !event.currentTarget.contains(range.commonAncestorContainer)) return;
                  event.preventDefault();
                  thoughtSelectionRef.current = range.cloneRange();
                  const otherDocument = docs.find(d => d.id !== selected.id);
                  setThoughtMenu({
                    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 278)),
                    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 370)),
                    text,
                    sourceDocumentId: selected.id,
                    targetDocumentId: otherDocument?.id ?? '',
                    choosingTarget: false,
                  });
                }}
              />}
              {!focus && selected && <div className="editor-footer"><div className="word-metrics"><span><b data-testid="text-word-count">{wordCount(selected.content, selected.contentFormat).toLocaleString()}</b> words in this {selected.type}</span><span className="metric-sep">·</span><span>{allWords.toLocaleString()} total</span></div><span className="editor-hint">Your words stay on this device</span></div>}
            </div>
            {!focus && selected && <section className="session-strip" aria-label="Writing sprint">
              <div className="sprint-icon"><Clock3 size={17}/></div><div className="sprint-copy"><b>Writing sprint</b><small>{timerOn ? 'Stay with the sentence.' : 'A little time, just for the work.'}</small></div>
              <div className="timer-readout" data-testid="text-sprint-timer">{fmtTime(timerSeconds)}</div><span className="timer-divider"/>
              <div className="session-words"><strong data-testid="text-session-words">{sessionWords}</strong><small>words this session</small></div>
              <button className="sprint-button" aria-label={timerOn ? 'Pause sprint' : 'Start sprint'} data-testid="button-sprint-toggle" onClick={startPauseTimer}>{timerOn ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}{timerOn ? 'Pause' : 'Begin'}</button>
              <button className="icon-btn reset-sprint" title="Reset sprint" aria-label="Reset sprint" data-testid="button-sprint-reset" onClick={resetTimer}><RotateCcw size={15}/></button>
            </section>}
          </section>
          {!focus && <aside className="right-rail">
            <div className="rail-tabs" role="tablist"><button role="tab" aria-selected={rightTab==='desk'} className={rightTab==='desk'?'active':''} onClick={() => setRightTab('desk')} data-testid="tab-writing-desk">Desk</button><button role="tab" aria-selected={rightTab==='research'} className={rightTab==='research'?'active':''} onClick={() => setRightTab('research')} data-testid="tab-research"><StickyNote size={14}/> Research <span className="tab-count">{notes.length}</span></button><button role="tab" aria-selected={rightTab==='thoughts'} className={rightTab==='thoughts'?'active':''} onClick={() => setRightTab('thoughts')} data-testid="tab-thoughts"><Sparkles size={14}/> Thoughts <span className="tab-count">{noteThoughts.length}</span></button><button role="tab" aria-selected={rightTab==='search'} className={rightTab==='search'?'active':''} onClick={() => setRightTab('search')} data-testid="tab-search"><Search size={14}/></button></div>
            {rightTab === 'desk' && <div className="rail-content">
              <div className="rail-date"><CalendarDays size={14}/>{shortDate(new Date())}</div>
              <h2 className="rail-heading">Make room<br/>for the work.</h2>
              <p className="rail-intro">Small returns become a book. Keep today’s promise gentle and specific.</p>
               <div className="daily-goal-card"><div className="daily-goal-head"><span>DAILY WORD GOAL</span><Target size={15}/></div><div className="daily-progress-value">{todayWords.toLocaleString()}<span> / {project.dailyGoal.toLocaleString()}</span></div><div className="daily-progress-track"><i style={{width:`${Math.min(100,todayWords/project.dailyGoal*100)}%`}}/></div><div className="daily-foot"><span>{Math.max(0,project.dailyGoal-todayWords).toLocaleString()} to go</span><button data-testid="button-edit-daily-goal-rail" onClick={() => { const v=window.prompt('Daily word goal',String(project.dailyGoal)); if(v&&Number(v)>0) updateProjectGoals({dailyGoal:Number(v)}); }}>Adjust</button></div></div>
              <div className="rail-section-head"><h3>In this scene</h3><span>{linkedNotes.length} references</span></div>
              {linkedNotes.length ? linkedNotes.map(n => <button className="linked-note" key={n.id} onClick={() => setRightTab('research')} data-testid={`linked-note-${n.id}`}><span className="note-pin"><Link2 size={12}/></span><span><b>{n.title}</b><small>{n.body.slice(0,67)}{n.body.length>67?'…':''}</small></span><ArrowUpRight size={13}/></button>) : <div className="no-linked"><span>No references linked to this scene.</span><button onClick={() => setModal({kind:'note'})} data-testid="button-create-first-reference">Add a reference <ArrowUpRight size={12}/></button></div>}
              <div className="rail-section-head consistency-head"><h3>Recent rhythm</h3><button title="Writing history" onClick={() => setRightTab('history')} data-testid="button-view-history">History <ArrowUpRight size={12}/></button></div>
               <div className="rhythm-card"><div className="rhythm-top"><div><b>{sessions.filter(s => new Date(s.startedAt) > new Date(Date.now()-7*86400000)).length}</b><span> sessions this week</span></div><span className="rhythm-flourish">↗</span></div><div className="week-bars">{Array.from({length:7},(_,i)=>{ const day=new Date();day.setDate(day.getDate()-(6-i)); const amount=sessions.filter(s=>new Date(s.startedAt).toDateString()===day.toDateString()).reduce((n,s)=>n+s.wordsWritten,0)+(day.toDateString()===new Date().toDateString()?sessionWords:0);return <div key={i} className="week-day"><div className={`bar-wrap ${amount?'has-words':''}`}><i style={{height:`${amount?Math.min(100,Math.max(18,amount/Math.max(project.dailyGoal,1)*100)):5}%`}}/></div><small>{day.toLocaleDateString(undefined,{weekday:'narrow'})}</small></div>})}</div><div className="streak-note"><CircleDot size={12}/> {sessions.length ? `${sessions[0].wordsWritten} words in your last saved session` : 'Your first session is waiting.'}</div></div>
              <div className="export-section"><div><b>Take your words with you</b><small>Export the full manuscript</small></div><div className="export-buttons"><button data-testid="button-export-txt" onClick={() => exportFile('txt')}><Download size={13}/> .txt</button><button data-testid="button-export-md" onClick={() => exportFile('md')}><Download size={13}/> .md</button></div></div>
            </div>}
             {rightTab === 'research' && <div className="rail-content research-pane"><div className="rail-date"><BookMarked size={14}/>RESEARCH DESK</div><div className="research-title-row"><div><h2 className="panel-heading">Loose threads</h2><p className="panel-subtitle">Things worth keeping close.</p></div><button className="add-reference" data-testid="button-add-reference" onClick={() => setModal({kind:'note'})}><Plus size={14}/> New note</button></div>
               {notes.length ? notes.map(n => <article className="research-card" key={n.id} data-testid={`research-note-${n.id}`}><div className="research-card-top"><span className="note-icon"><StickyNote size={14}/></span><div className="research-note-title">{n.title}</div><button className="icon-btn note-edit" title="Edit note" data-testid={`button-edit-note-${n.id}`} onClick={() => setModal({kind:'note',noteId:n.id})}><Pencil size={13}/></button><button className="icon-btn note-delete" title="Delete note" data-testid={`button-delete-note-${n.id}`} onClick={() => {if(window.confirm(`Delete “${n.title}”?`)){patchStore(s=>({...s,notes:s.notes.filter(x=>x.id!==n.id)}));setNotice('Reference deleted.');}}}><Trash2 size={13}/></button></div><p>{n.body}</p><div className="tag-row">{n.tags.map(tag=><span className="tag" key={tag}>{tag}</span>)}</div><div className="note-association"><span><Link2 size={12}/> Linked scenes</span><div className="link-picker">{scenes.map(sc=><button key={sc.id} className={n.linkedDocumentIds.includes(sc.id)?'is-linked':''} title={sc.title} data-testid={`button-link-${n.id}-${sc.id}`} onClick={()=>toggleLink(n.id,sc.id)}>{n.linkedDocumentIds.includes(sc.id)?<Check size={12}/>:<Plus size={12}/>}<span>{sc.title}</span></button>)}</div></div></article>) : <div className="research-empty"><BookMarked size={27}/><b>A place for the things you find.</b><span>Keep a detail, a question, a line you might need later.</span><button onClick={()=>setModal({kind:'note'})}>Write a first note</button></div>}</div>}
            {rightTab === 'thoughts' && <div className="rail-content thoughts-pane">
              <div className="rail-date"><Sparkles size={14}/>THOUGHTS</div>
              <div className="research-title-row"><div><h2 className="panel-heading">Keep the thread.</h2><p className="panel-subtitle">Save a passage here, elsewhere, or for later.</p></div></div>
              <div className="thought-subnav" role="tablist" aria-label="Thought lists">
                <button type="button" role="tab" aria-selected={thoughtPanelMode === 'thoughts'} className={thoughtPanelMode === 'thoughts' ? 'active' : ''} onClick={() => setThoughtPanelMode('thoughts')} data-testid="tab-thought-list">Thoughts <span>{noteThoughts.length}</span></button>
                <button type="button" role="tab" aria-selected={thoughtPanelMode === 'needsWork'} className={thoughtPanelMode === 'needsWork' ? 'active' : ''} onClick={() => setThoughtPanelMode('needsWork')} data-testid="tab-needs-work">Needs work <span>{openWorkItems.length}</span></button>
              </div>
              {thoughtPanelMode === 'thoughts' && <>
                <section className="thought-group" aria-label="Thoughts for the current page">
                  <div className="thought-group-head"><h3>{selected?.title ?? 'Current page'}</h3><span>{pageThoughts.length}</span></div>
                  {pageThoughts.length ? pageThoughts.map(thought => {
                    const sourceTitle = docs.find(d => d.id === thought.sourceDocumentId)?.title ?? 'A page no longer in this binder';
                    return <ThoughtCard key={thought.id} thought={thought} badge={thought.kind === 'another' ? 'Assigned here' : 'Saved here'} origin={thought.kind === 'another' ? `Selected in ${sourceTitle}` : 'Selected from this page'} onDelete={() => deleteThought(thought.id)}/>;
                  }) : <div className="thought-empty" data-testid="empty-page-thoughts"><Sparkles size={18}/><span>Right-click selected manuscript text to save a thought for this page.</span></div>}
                </section>
                <section className="thought-group" aria-label="Future thoughts">
                  <div className="thought-group-head"><h3>For the future</h3><span>{futureThoughts.length}</span></div>
                  {futureThoughts.length ? futureThoughts.map(thought => {
                    const sourceTitle = docs.find(d => d.id === thought.sourceDocumentId)?.title ?? 'A page no longer in this binder';
                    return <ThoughtCard key={thought.id} thought={thought} badge="For later" origin={`Selected in ${sourceTitle}`} onDelete={() => deleteThought(thought.id)}/>;
                  }) : <p className="thought-future-empty">Ideas saved for later will stay here until you decide where they belong.</p>}
                </section>
              </>}
              {thoughtPanelMode === 'needsWork' && <>
                <section className="thought-group" aria-label="Unsolved work">
                  <div className="thought-group-head"><h3>To solve</h3><span>{openWorkItems.length}</span></div>
                  {openWorkItems.length ? openWorkItems.map(thought => {
                    const source = docs.find(d => d.id === thought.sourceDocumentId);
                    return <NeedsWorkCard key={thought.id} thought={thought} pageTitle={source?.title ?? 'Page no longer in this binder'} onSolve={() => solveThought(thought.id)} onDelete={() => deleteThought(thought.id)} onOpen={() => {
                      if (source?.parentId) setExpanded(current => current.includes(source.parentId!) ? current : [...current, source.parentId!]);
                      setSelectedId(source?.id ?? '');
                    }}/>;
                  }) : <div className="thought-empty" data-testid="empty-needs-work"><Check size={18}/><span>No open work items. Mark a selected passage “Needs work” from the manuscript menu.</span></div>}
                </section>
                {!!solvedWorkItems.length && <section className="thought-group solved-work-group" aria-label="Solved work">
                  <div className="thought-group-head"><h3>Solved</h3><span>{solvedWorkItems.length}</span></div>
                  {solvedWorkItems.map(thought => {
                    const source = docs.find(d => d.id === thought.sourceDocumentId);
                    return <NeedsWorkCard key={thought.id} thought={thought} pageTitle={source?.title ?? 'Page no longer in this binder'} onSolve={() => {}} onDelete={() => deleteThought(thought.id)} onOpen={() => {
                      if (source?.parentId) setExpanded(current => current.includes(source.parentId!) ? current : [...current, source.parentId!]);
                      setSelectedId(source?.id ?? '');
                    }}/>;
                  })}
                </section>}
              </>}
            </div>}
            {rightTab === 'search' && <div className="rail-content search-pane"><div className="rail-date"><Search size={14}/>PROJECT SEARCH</div><h2 className="panel-heading">Find the thread.</h2><div className="search-field"><Search size={16}/><input id="global-search" aria-label="Search manuscript and research" placeholder="Words, names, details…" data-testid="input-project-search" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={14}/></button>}</div><span className="search-scope">Searching manuscript and research notes</span>
              {query ? <div className="search-results">{searchResults.length ? <>{searchResults.map(r=><button className="search-result" key={`${r.kind}-${r.id}`} onClick={r.onClick} data-testid={`search-result-${r.id}`}><span className="result-type">{r.kind==='reference'?<StickyNote size={13}/>:<FileText size={13}/>} {r.kind}</span><b>{r.title}</b><small>{r.excerpt.slice(0,110)}{r.excerpt.length>110?'…':''}</small></button>)}</> : <div className="search-empty"><Search size={20}/><span>No matches yet. Try another phrase.</span></div>}</div> : <div className="search-hint"><div className="hint-glyph">“ ”</div><b>Search across the whole book.</b><span>Try a character, place, or phrase you remember writing.</span></div>}</div>}
            {rightTab === 'history' && <div className="rail-content"><div className="rail-date"><Clock3 size={14}/>SESSION HISTORY</div><div className="research-title-row"><div><h2 className="panel-heading">The pages add up.</h2><p className="panel-subtitle">Every return is part of the work.</p></div><button className="text-action" onClick={()=>setRightTab('desk')}>Back to desk</button></div>{sessions.length ? sessions.map(s=><div className="history-row" key={s.id}><span className="history-mark"><Feather size={14}/></span><div><b>{shortDate(new Date(s.startedAt))}</b><small>{Math.round(s.durationSeconds/60)} min · {s.wordsWritten} words</small></div><span className="history-total">+{s.wordsWritten}</span></div>) : <div className="research-empty"><Clock3 size={26}/><b>Your rhythm begins here.</b><span>Complete a writing sprint and your sessions will find a home here.</span></div>}</div>}
          </aside>}
        </div>
      </section>
      {thoughtMenu && <div className="thought-menu-layer" data-testid="thought-context-layer" onPointerDown={event => { if (event.target === event.currentTarget) { setThoughtMenu(null); thoughtSelectionRef.current = null; } }}>
        <div className="thought-context-menu" role="dialog" aria-label="Save selected text" style={{ left: thoughtMenu.x, top: thoughtMenu.y }}>
          <div className="thought-context-heading"><span className="thought-menu-icon"><Sparkles size={14}/></span><b>Save this selection</b></div>
          <p className="thought-selection-preview">“{thoughtMenu.text.length > 125 ? `${thoughtMenu.text.slice(0, 125)}…` : thoughtMenu.text}”</p>
          <button type="button" className="thought-menu-action" data-testid="button-save-thought-current" onClick={() => saveThought('current')}>
            <span><b>This page</b><small>Show it while this page is open</small></span><ChevronRight size={14}/>
          </button>
          <button type="button" className="thought-menu-action" data-testid="button-choose-thought-page" disabled={!thoughtMenuDocuments.length} onClick={() => setThoughtMenu(menu => menu ? { ...menu, choosingTarget: !menu.choosingTarget } : null)}>
            <span><b>Another chapter or page</b><small>Choose where it should appear</small></span><ChevronRight size={14}/>
          </button>
          {!thoughtMenuDocuments.length && <p className="thought-menu-hint">Add another chapter or page before assigning this thought elsewhere.</p>}
          {thoughtMenu.choosingTarget && !!thoughtMenuDocuments.length && <div className="thought-target-picker">
            <label htmlFor="select-thought-target">Save it to</label>
            <select id="select-thought-target" value={thoughtMenu.targetDocumentId} onChange={event => setThoughtMenu(menu => menu ? { ...menu, targetDocumentId: event.target.value } : null)} data-testid="select-thought-target">
              {thoughtMenuDocuments.map(doc => <option key={doc.id} value={doc.id}>{doc.type === 'chapter' ? doc.title : `${docs.find(parent => parent.id === doc.parentId)?.title ?? 'Chapter'} — ${doc.title}`}</option>)}
            </select>
            <button type="button" disabled={!thoughtMenu.targetDocumentId} data-testid="button-save-thought-another" onClick={() => saveThought('another', thoughtMenu.targetDocumentId)}>Save to page</button>
          </div>}
          <button type="button" className="thought-menu-action" data-testid="button-save-thought-future" onClick={() => saveThought('future')}>
            <span><b>For the future</b><small>Keep it unassigned for now</small></span><ChevronRight size={14}/>
          </button>
          <div className="thought-menu-divider"/>
          <button type="button" className="thought-menu-action needs-work-action" data-testid="button-save-thought-needs-work" onClick={() => saveThought('needs-work')}>
            <span><b>Needs work</b><small>Keep it italic until you solve it</small></span><ChevronRight size={14}/>
          </button>
          <button type="button" className="thought-menu-cancel" data-testid="button-cancel-thought-menu" onClick={() => { setThoughtMenu(null); thoughtSelectionRef.current = null; }}>Cancel</button>
        </div>
      </div>}
      {modal && <Modal key={`${modal.kind}-${modal.kind === 'note' ? modal.noteId ?? 'new' : modal.kind === 'document' ? modal.parentId ?? 'new' : 'new'}`} modal={modal} notes={notes} docs={docs} selectedId={selected?.id} onClose={()=>setModal(null)} onDocument={addDocument} onNote={saveNote} onProject={createProject}/>}
      {notice && <div className="toast-message" role="status" data-testid="status-notice"><Check size={15}/>{notice}</div>}
    </main>
  );
}

function ThoughtCard({ thought, badge, origin, onDelete }: { thought: Thought; badge: string; origin: string; onDelete: () => void }) {
  return <article className="thought-card" data-testid={`thought-card-${thought.id}`}>
    <div className="thought-card-top"><span className="thought-badge">{badge}</span><button type="button" className="thought-delete" title="Remove thought" aria-label="Remove thought" onClick={onDelete}><Trash2 size={13}/></button></div>
    <blockquote>{thought.content}</blockquote>
    <small className="thought-origin">{origin}</small>
  </article>;
}

function NeedsWorkCard({ thought, pageTitle, onSolve, onDelete, onOpen }: {
  thought: Thought;
  pageTitle: string;
  onSolve: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const solved = !!thought.resolvedAt;
  return <article className={`thought-card needs-work-card ${solved ? 'is-solved' : ''}`} data-testid={`needs-work-card-${thought.id}`}>
    <div className="thought-card-top">
      <span className={`thought-badge ${solved ? 'solved-badge' : 'open-badge'}`}>{solved ? 'Solved' : 'Needs work'}</span>
      <button type="button" className="thought-delete" title="Remove work item" aria-label="Remove work item" onClick={onDelete}><Trash2 size={13}/></button>
    </div>
    <blockquote>{thought.content}</blockquote>
    <button type="button" className="work-page-link" onClick={onOpen}><FileText size={12}/>{pageTitle}</button>
    <div className="needs-work-actions">
      {!solved && <button type="button" className="solve-work-button" onClick={onSolve} data-testid={`button-solve-work-${thought.id}`}><Check size={13}/> Mark solved</button>}
    </div>
  </article>;
}

function Modal({modal, notes, docs, selectedId, onClose, onDocument, onNote, onProject}: {
  modal: ModalState;
  notes: ResearchNote[];
  docs: Document[];
  selectedId?: string;
  onClose: () => void;
  onDocument: (title: string, type: 'chapter' | 'scene', parentId?: string) => void;
  onNote: (title: string, body: string, tags: string, noteId?: string) => void;
  onProject: (title: string) => void;
}) {
  const existing = modal.kind === 'note' ? notes.find(n => n.id === modal.noteId) : undefined;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [type, setType] = useState<'chapter' | 'scene'>(modal.kind === 'document' && modal.parentId ? 'scene' : 'chapter');
  const defaultParentId = docs.find(d => d.type === 'chapter')?.id ?? '';
  const [parentId, setParentId] = useState(modal.kind === 'document' ? modal.parentId ?? defaultParentId : defaultParentId);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (modal.kind === 'document') onDocument(title.trim(), type, type === 'scene' ? parentId : undefined);
    else if (modal.kind === 'note') onNote(title.trim(), body, tags, modal.noteId);
    else onProject(title.trim());
  };

  const modalTitle = modal.kind === 'project'
    ? 'Start a new novel.'
    : modal.kind === 'document'
      ? 'Give it a place.'
      : existing ? 'Return to this note.' : 'Keep this close.';

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal-card" onSubmit={submit} data-testid="form-modal">
      <div className="modal-header">
        <div>
          <span className="modal-kicker">{modal.kind === 'document' ? 'MANUSCRIPT BINDER' : modal.kind === 'project' ? 'NEW NOVEL' : 'RESEARCH DESK'}</span>
          <h2>{modalTitle}</h2>
        </div>
        <button type="button" className="icon-btn" aria-label="Close dialog" data-testid="button-close-modal" onClick={onClose}><X size={17}/></button>
      </div>
      {modal.kind === 'project' ? <>
        <label className="field-label" htmlFor="project-title">Novel title</label>
        <input ref={titleRef} id="project-title" className="form-input" placeholder="e.g. The Glass Orchard" value={title} onChange={event => setTitle(event.target.value)} data-testid="input-new-project-title" required/>
        <p className="modal-description">This creates a separate workroom with its own binder, research, and writing goals. Your other novels stay unchanged.</p>
      </> : modal.kind === 'document' ? <>
        <label className="field-label" htmlFor="document-title">Title</label>
        <input ref={titleRef} id="document-title" className="form-input" placeholder={type === 'chapter' ? 'Chapter title' : 'Scene title'} value={title} onChange={event => setTitle(event.target.value)} data-testid="input-new-document-title"/>
        <div className="form-row">
          <label className="field-label">This is a</label>
          <div className="segmented">
            <button type="button" className={type === 'chapter' ? 'chosen' : ''} onClick={() => setType('chapter')} data-testid="button-type-chapter">Chapter</button>
            <button type="button" className={type === 'scene' ? 'chosen' : ''} onClick={() => setType('scene')} data-testid="button-type-scene">Scene</button>
          </div>
        </div>
        {type === 'scene' && <>
          <label className="field-label" htmlFor="scene-parent">Inside chapter</label>
          <select id="scene-parent" className="form-input" value={parentId} onChange={event => setParentId(event.target.value)} data-testid="select-scene-parent">{docs.filter(d => d.type === 'chapter').map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
        </>}
      </> : <>
        <label className="field-label" htmlFor="note-title">Title</label>
        <input ref={titleRef} id="note-title" className="form-input" placeholder="A name you’ll remember" value={title} onChange={event => setTitle(event.target.value)} data-testid="input-note-title"/>
        <label className="field-label" htmlFor="note-body">The detail</label>
        <textarea id="note-body" className="form-input note-body-input" placeholder="Write down the detail, question, or thought…" value={body} onChange={event => setBody(event.target.value)} data-testid="input-note-body"/>
        <label className="field-label" htmlFor="note-tags">Tags <span>Separate with commas</span></label>
        <input id="note-tags" className="form-input" placeholder="character, setting, research" value={tags} onChange={event => setTags(event.target.value)} data-testid="input-note-tags"/>
        <div className="modal-link-hint"><Link2 size={14}/>This note will be linked to <b>{docs.find(d => d.id === selectedId)?.title ?? 'your current scene'}</b>. You can link it elsewhere later.</div>
      </>}
      <div className="modal-actions">
        <button type="button" className="cancel-button" onClick={onClose} data-testid="button-cancel-modal">Cancel</button>
        <button className="submit-button" type="submit" disabled={!title.trim()} data-testid="button-submit-modal">{modal.kind === 'document' ? 'Add to binder' : modal.kind === 'project' ? 'Create novel' : existing ? 'Save note' : 'File this note'}</button>
      </div>
    </form>
  </div>;
}