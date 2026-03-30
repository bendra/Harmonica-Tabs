import { useState, useMemo, useRef, Dispatch, SetStateAction } from 'react';
import { TextInput } from 'react-native';
import {
  cleanupTransposerInput,
  normalizeTransposerEditInput,
  TextSelection,
} from '../logic/transposer-input';
import { buildSavedTabTitleCandidate, SavedTabRecord } from '../logic/saved-tab-library';
import { savedTabLibraryService } from './use-saved-tab-library';

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
  deleteSavedTab: (record: SavedTabRecord) => Promise<void>;
};

export function useTabEditor({
  savedTabs,
  setSavedTabs,
  setSavedTabsStatus,
  setTransposerSourceTabId,
  setTabsSubview,
  setTabsEditorVisible,
  setScreen,
  deleteSavedTab,
}: TabEditorParams) {
  const [editorInput, setEditorInput] = useState('');
  const [editorSelection, setEditorSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [editorSavedTabId, setEditorSavedTabId] = useState<string | null>(null);
  const [editorReturnTo, setEditorReturnTo] = useState<TabsSubview>('library');
  const [saveTabModalVisible, setSaveTabModalVisible] = useState(false);
  const [saveTabMode, setSaveTabMode] = useState<SaveTabMode>('overwrite');
  const [saveTabTitleInput, setSaveTabTitleInput] = useState('');
  const [saveTabTitleError, setSaveTabTitleError] = useState<string | null>(null);
  const [pendingOpenRecord, setPendingOpenRecord] = useState<SavedTabRecord | null>(null);
  const [openAfterSaveRecordId, setOpenAfterSaveRecordId] = useState<string | null>(null);
  const [closeEditorModalVisible, setCloseEditorModalVisible] = useState(false);

  const editorInputRef = useRef<TextInput>(null);

  const editorSavedTab = useMemo(
    () => savedTabs.find((tab) => tab.id === editorSavedTabId) ?? null,
    [editorSavedTabId, savedTabs],
  );

  const hasUnsavedEditorChanges = editorSavedTab
    ? editorInput !== editorSavedTab.inputText
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
    setSaveTabTitleError(null);
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
    setSaveTabTitleError(null);
    setOpenAfterSaveRecordId(nextOpenRecordId);
    setSaveTabModalVisible(true);
    setSavedTabsStatus(null);
  }

  function startNewDraft() {
    setEditorInput('');
    setEditorSelection({ start: 0, end: 0 });
    setEditorSavedTabId(null);
    setPendingOpenRecord(null);
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
    const nextTitle = saveTabTitleInput.trim();
    if (nextTitle.length === 0) {
      setSaveTabTitleError('Title is required.');
      return;
    }

    try {
      const nextSaveMode = saveTabMode;
      const nextOpenRecordId = openAfterSaveRecordId;
      const saveTargetId = nextSaveMode === 'create_new' ? null : editorSavedTabId;
      const result = await savedTabLibraryService.saveTab({
        id: saveTargetId,
        title: nextTitle,
        inputText: editorInput,
      });
      setSavedTabs(result.tabs);
      setEditorSavedTabId(result.savedTab.id);
      setSavedTabsStatus(`Saved "${result.savedTab.title}".`);
      closeSaveTabModal();

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
      setSaveTabTitleError(nextMessage);
    }
  }

  function handleSavedTabEditPress(record: SavedTabRecord) {
    if (!hasUnsavedEditorChanges) {
      openSavedTabInEditor(record, 'library');
      return;
    }

    const wouldReplaceCurrentInput = editorSavedTabId !== record.id || editorInput !== record.inputText;

    if (!wouldReplaceCurrentInput) {
      openSavedTabInEditor(record, 'library');
      return;
    }

    setPendingOpenRecord(record);
  }

  function handleSavedTabTransposePress(record: SavedTabRecord) {
    setTransposerSourceTabId(record.id);
    setSavedTabsStatus(`Selected "${record.title}" for transposing.`);
    setTabsEditorVisible(false);
    setTabsSubview('transpose');
    setScreen('tabs');
  }

  async function handleDeleteSavedTab(record: SavedTabRecord) {
    try {
      await deleteSavedTab(record);
      setPendingOpenRecord((prev) => (prev?.id === record.id ? null : prev));
      if (editorSavedTabId === record.id) {
        setEditorSavedTabId(null);
      }
      setTransposerSourceTabId((prev) => (prev === record.id ? null : prev));
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
    pendingOpenRecord,
    setPendingOpenRecord,
    closeEditorModalVisible,
    setCloseEditorModalVisible,
    editorSavedTab,
    hasUnsavedEditorChanges,
    editorInputRef,
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
    handleSavedTabTransposePress,
    handleDeleteSavedTab,
  };
}
