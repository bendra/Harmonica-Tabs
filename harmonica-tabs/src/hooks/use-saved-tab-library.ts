import { useState, useEffect } from 'react';
import { createSavedTabLibraryService, SavedTabRecord } from '../logic/saved-tab-library';

export const savedTabLibraryService = createSavedTabLibraryService();

export function useSavedTabLibrary() {
  const [savedTabs, setSavedTabs] = useState<SavedTabRecord[]>([]);
  const [savedTabsStatus, setSavedTabsStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    savedTabLibraryService
      .listTabs()
      .then((tabs) => {
        if (cancelled) return;
        setSavedTabs(tabs);
      })
      .catch(() => {
        if (cancelled) return;
        setSavedTabsStatus('Saved tabs could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function deleteSavedTab(record: SavedTabRecord): Promise<SavedTabRecord[]> {
    const nextTabs = await savedTabLibraryService.deleteTab(record.id);
    setSavedTabs(nextTabs);
    return nextTabs;
  }

  return {
    savedTabs,
    setSavedTabs,
    savedTabsStatus,
    setSavedTabsStatus,
    deleteSavedTab,
  };
}
