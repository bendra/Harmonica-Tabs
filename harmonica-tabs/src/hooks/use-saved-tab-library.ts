import { useState, useEffect } from 'react';
import { createSavedTabLibraryService, SavedTabRecord } from '../logic/saved-tab-library';

let savedTabLibraryService = createSavedTabLibraryService();

export function getSavedTabLibraryService() {
  return savedTabLibraryService;
}

export function resetSavedTabLibraryServiceForTests() {
  savedTabLibraryService = createSavedTabLibraryService();
}

export function useSavedTabLibrary() {
  const [savedTabs, setSavedTabs] = useState<SavedTabRecord[]>([]);
  const [savedTabsStatus, setSavedTabsStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getSavedTabLibraryService()
      .listTabs()
      .then((tabs) => {
        if (cancelled) return;
        setSavedTabs(tabs);
      })
      .catch((error) => {
        if (cancelled) return;
        const message =
          error instanceof Error && error.message ? error.message : 'Saved tabs could not be loaded.';
        setSavedTabsStatus(message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function deleteSavedTab(record: SavedTabRecord): Promise<SavedTabRecord[]> {
    const nextTabs = await getSavedTabLibraryService().deleteTab(record.id);
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
