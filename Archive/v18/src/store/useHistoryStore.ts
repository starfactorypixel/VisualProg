// src/store/useHistoryStore.ts
import { useState, useEffect } from 'react';

interface HistoryEntry {
  id: string;
  content: string;
  timestamp: Date;
}

interface EditorState {
  history: HistoryEntry[];
  current: string;
}

export const useHistoryStore = () => {
  const [state, setState] = useState<EditorState>({
    history: [],
    current: ''
  });

  // Track file modifications
  useEffect(() => {
    const handleFileEdit = (file: string) => {
      const snapshot = readExistingFile(file);
      setState(prev => ({
        ...prev,
        history: [...prev.history, { id: uuid(), content: snapshot, timestamp: new Date() }]
      }));
    };
    
    // Add event listener for file edits
    window.addEventListener('file-edit', handleFileEdit);
    
    return () => {
      window.removeEventListener('file-edit', handleFileEdit);
    };
  }, []);

  // Add custom undo functionality
  const undo = () => {
    if (state.history.length > 0) {
      setState(prev => ({
        ...prev,
        current: prev.history[prev.history.length - 1].content,
        history: prev.history.slice(0, -1)
      }));
    }
  };

  return { state, undo };
};