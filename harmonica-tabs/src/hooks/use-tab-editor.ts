import { useState, useMemo, useRef, Dispatch, SetStateAction } from 'react';
import { TextInput } from 'react-native';
import {
  cleanupTransposerInput,
  normalizeTransposerEditInput,
  TextSelection,
} from '../logic/transposer-input';
import {
  buildSavedTabTitleCandidate,
  getSavedTabContext,
  SavedTabContext,
  SavedTabRecord,
} from '../logic/saved-tab-library';
import { getSavedTabLibraryService } from './use-saved-tab-library';

export type SaveTabMode = 'overwrite' | 'create_new' | 'save_then_open' | 'save_then_close';
export type TabsSubview = 'transpose' | 'library';

type TabEditorParams = {
  savedTabs: SavedTabRecord[];
  setSavedTabs: (tabs: SavedTabRecord[]) => void;
  setSavedTabsStatus: (status: string | null) => void;
  setTransposerSourceTabId: Dispatch<SetStateAction<string | null>>;
  setTabsSubview: (subview: TabsSubview) => void;
  setTabsEditorVisible: (visible: boolean) => void;
  setScreen: (screen: 'scales' | 'tabs' | 'properties' | 'tab-symbols') => void;
  deleteSavedTab: (record: SavedTabRecord) => Promise<SavedTabRecord[]>;
  currentHarmonicaPc: number;
  currentPositionNumber: number;
};

function sameSavedContext(left: SavedTabContext, right: SavedTabContext) {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return left.harmonicaPc === right.harmonicaPc && left.positionNumber === right.positionNumber;
}

function debugTabEditor(step: string, details?: Record<string, unknown>) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[tab-editor]', step, details ?? {});
  }
}

export function useTabEditor({
  savedTabs,
  setSavedTabs,
  setSavedTabsStatus,
  setTransposerSourceTabId,
  setTabsSubview,
  setTabsEditorVisible,
  setScreen,
  deleteSavedTab,
  currentHarmonicaPc,
  currentPositionNumber,
}: TabEditorParams) {
  const [editorInput, setEditorInput] = useState('');
  const [editorSelection, setEditorSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [editorSavedTabId, setEditorSavedTabId] = useState<string | null>(null);
  const [editorReturnTo, setEditorReturnTo] = useState<TabsSubview>('library');
  const [saveTabModalVisible, setSaveTabModalVisible] = useState(false);
  const [saveTabMode, setSaveTabMode] = useState<SaveTabMode>('overwrite');
  const [saveTabTitleInput, setSaveTabTitleInput] = useState('');
  const [saveTabTitleError, setSaveTabTitleError] = useState<string | null>(null);
  const [isSavingTab, setIsSavingTab] = useState(false);
  const [pendingOpenRecord, setPendingOpenRecord] = useState<SavedTabRecord | null>(null);
  const [openAfterSaveRecordId, setOpenAfterSaveRecordId] = useState<string | null>(null);
  const [closeEditorModalVisible, setCloseEditorModalVisible] = useState(false);
  const [saveWithContext, setSaveWithContext] = useState(false);
  const [draftSavedContext, setDraftSavedContext] = useState<SavedTabContext>(null);

  const editorInputRef = useRef<TextInput>(null);
  const saveTabTitleInputRef = useRef('');
  const isSavingTabRef = useRef(false);

  const editorSavedTab = useMemo(
    () => savedTabs.find((tab) => tab.id === editorSavedTabId) ?? null,
    [editorSavedTabId, savedTabs],
  );

  const currentSelectionContext = useMemo<SavedTabContext>(
    () => ({
      harmonicaPc: currentHarmonicaPc,
      positionNumber: currentPositionNumber,
    }),
    [currentHarmonicaPc, currentPositionNumber],
  );

  const linkedSavedContext = editorSavedTab ? getSavedTabContext(editorSavedTab) : null;
  const effectiveDraftContext = saveWithContext ? draftSavedContext : null;
  const hasUnsavedContextChanges = editorSavedTab ? !sameSavedContext(linkedSavedContext, effectiveDraftContext) : false;
  const hasUnsavedEditorChanges = editorSavedTab
    ? editorInput !== editorSavedTab.inputText || hasUnsavedContextChanges
    : editorInput.trim().length > 0;

  function handleEditorInputChange(value: string) {
    setEditorInput(normalizeTransposerEditInput(value));
  }

  function handleCleanEditorInput() {
    const cleaned = cleanupTransposerInput(editorInput, {
      stripInvalidContent: true,
      removeExcessWhitespace: true,
    });
    setEditorInput(cleaned);
    setEditorSelection((prev) => ({
      start: Math.min(prev.start, cleaned.length),
      end: Math.min(prev.end, cleaned.length),
    }));
  }

  function closeSaveTabModal() {
    setSaveTabModalVisible(false);
    setSaveTabMode('overwrite');
    setSaveTabTitleInput('');
    saveTabTitleInputRef.current = '';
    setSaveTabTitleError(null);
    setIsSavingTab(false);
    isSavingTabRef.current = false;
    setOpenAfterSaveRecordId(null);
  }

  function resetEditorDialogState() {
    closeSaveTabModal();
    setCloseEditorModalVisible(false);
    setPendingOpenRecord(null);
  }

  function openSaveTabModal(mode: SaveTabMode = 'overwrite', nextOpenRecordId: string | null = null) {
    if (editorInput.trim().length === 0) {
      setSavedTabsStatus('Enter some tab text before saving.');
      return;
    }

    const defaultTitle = editorSavedTab?.title ?? buildSavedTabTitleCandidate(editorInput);

    setSaveTabMode(mode);
    setSaveTabTitleInput(defaultTitle);
    saveTabTitleInputRef.current = defaultTitle;
    setSaveTabTitleError(null);
    setIsSavingTab(false);
    isSavingTabRef.current = false;
    setOpenAfterSaveRecordId(nextOpenRecordId);
    setSaveTabModalVisible(true);
    setSavedTabsStatus(null);
  }

  function handleSaveTabTitleInputChange(value: string) {
    saveTabTitleInputRef.current = value;
    setSaveTabTitleInput(value);
    if (saveTabTitleError) {
      setSaveTabTitleError(null);
    }
  }

  function applyDraftState(record: SavedTabRecord | null) {
    const nextSavedContext = record ? getSavedTabContext(record) : null;
    setSaveWithContext(nextSavedContext !== null);
    setDraftSavedContext(nextSavedContext ?? currentSelectionContext);
  }

  function startNewDraft() {
    setEditorInput('');
    setEditorSelection({ start: 0, end: 0 });
    setEditorSavedTabId(null);
    setPendingOpenRecord(null);
    setSaveWithContext(false);
    setDraftSavedContext(currentSelectionContext);
    setSavedTabsStatus('Started a new tab.');
    requestAnimationFrame(() => {
      editorInputRef.current?.focus();
    });
  }

  function finishClosingEditor() {
    resetEditorDialogState();
    setTabsEditorVisible(false);
    setTabsSubview(editorReturnTo);
  }

  function handleEditorCloseRequest() {
    if (hasUnsavedEditorChanges) {
      setCloseEditorModalVisible(true);
      return;
    }
    finishClosingEditor();
  }

  function openSavedTabInEditor(record: SavedTabRecord, returnTo: TabsSubview = 'library') {
    setEditorInput(record.inputText);
    setEditorSelection({ start: 0, end: 0 });
    setEditorSavedTabId(record.id);
    applyDraftState(record);
    setEditorReturnTo(returnTo);
    setPendingOpenRecord(null);
    setTabsSubview(returnTo);
    setTabsEditorVisible(true);
    setScreen('tabs');
    setSavedTabsStatus(`Opened "${record.title}" in the editor.`);
    requestAnimationFrame(() => {
      editorInputRef.current?.focus();
    });
  }

  function openEditorForNewDraft(returnTo: TabsSubview) {
    startNewDraft();
    setEditorReturnTo(returnTo);
    setTabsSubview(returnTo);
    setTabsEditorVisible(true);
    setScreen('tabs');
    setSavedTabsStatus(null);
  }

  async function handleSaveTabConfirm() {
    debugTabEditor('save-confirm:entered', {
      saveMode: saveTabMode,
      modalVisible: saveTabModalVisible,
      titleLength: saveTabTitleInputRef.current.trim().length,
    });
    if (isSavingTabRef.current) {
      debugTabEditor('save-confirm:ignored-already-saving');
      return;
    }

    const nextTitle = saveTabTitleInputRef.current.trim();
    if (nextTitle.length === 0) {
      setSaveTabTitleError('Title is required.');
      return;
    }

    try {
      isSavingTabRef.current = true;
      setIsSavingTab(true);
      setSaveTabTitleInput(nextTitle);
      saveTabTitleInputRef.current = nextTitle;
      const nextSaveMode = saveTabMode;
      const nextOpenRecordId = openAfterSaveRecordId;
      const saveTargetId = nextSaveMode === 'create_new' ? null : editorSavedTabId;
      const savedContext = saveWithContext ? draftSavedContext : null;
      const result = await getSavedTabLibraryService().saveTab({
        id: saveTargetId,
        title: nextTitle,
        inputText: editorInput,
        harmonicaPc: savedContext?.harmonicaPc ?? null,
        positionNumber: savedContext?.positionNumber ?? null,
      });
      setSavedTabs(result.tabs);
      setEditorSavedTabId(result.savedTab.id);
      applyDraftState(result.savedTab);
      setSavedTabsStatus(`Saved "${result.savedTab.title}".`);
      closeSaveTabModal();
      debugTabEditor('save-confirm:resolved', {
        savedTabId: result.savedTab.id,
      });

      if (nextSaveMode === 'save_then_close') {
        finishClosingEditor();
        return;
      }

      if (nextOpenRecordId) {
        const nextRecord = result.tabs.find((tab) => tab.id === nextOpenRecordId) ?? null;
        if (nextRecord) {
          openSavedTabInEditor(nextRecord, 'library');
        }
        return;
      }

      finishClosingEditor();
    } catch (error) {
      const nextMessage = error instanceof Error && error.message ? error.message : 'Could not save this tab.';
      debugTabEditor('save-confirm:error', { message: nextMessage });
      setSaveTabTitleError(nextMessage);
      setIsSavingTab(false);
      isSavingTabRef.current = false;
    }
  }

  function handleSavedTabEditPress(record: SavedTabRecord) {
    if (!hasUnsavedEditorChanges) {
      openSavedTabInEditor(record, 'library');
      return;
    }

    const nextRecordContext = getSavedTabContext(record);
    const wouldReplaceCurrentInput =
      editorSavedTabId !== record.id ||
      editorInput !== record.inputText ||
      !sameSavedContext(effectiveDraftContext, nextRecordContext);

    if (!wouldReplaceCurrentInput) {
      openSavedTabInEditor(record, 'library');
      return;
    }

    setPendingOpenRecord(record);
  }

  async function handleDeleteSavedTab(record: SavedTabRecord) {
    try {
      const nextTabs = await deleteSavedTab(record);
      setPendingOpenRecord((prev) => (prev?.id === record.id ? null : prev));
      if (editorSavedTabId === record.id) {
        setEditorSavedTabId(null);
      }
      setTransposerSourceTabId((prev) => (prev === record.id ? null : prev));
      setSavedTabs(nextTabs);
      setSavedTabsStatus(`Deleted "${record.title}".`);
    } catch {
      setSavedTabsStatus('Could not delete that saved tab.');
    }
  }

  return {
    editorInput,
    setEditorInput,
    editorSelection,
    setEditorSelection,
    editorSavedTabId,
    editorReturnTo,
    saveTabModalVisible,
    saveTabMode,
    saveTabTitleInput,
    setSaveTabTitleInput,
    saveTabTitleError,
    setSaveTabTitleError,
    isSavingTab,
    pendingOpenRecord,
    setPendingOpenRecord,
    closeEditorModalVisible,
    setCloseEditorModalVisible,
    editorSavedTab,
    hasUnsavedEditorChanges,
    editorInputRef,
    saveWithContext,
    setSaveWithContext,
    draftSavedContext,
    setDraftSavedContext,
    handleSaveTabTitleInputChange,
    handleEditorInputChange,
    handleCleanEditorInput,
    closeSaveTabModal,
    openSaveTabModal,
    finishClosingEditor,
    handleEditorCloseRequest,
    openSavedTabInEditor,
    openEditorForNewDraft,
    handleSaveTabConfirm,
    handleSavedTabEditPress,
    handleDeleteSavedTab,
  };
}
