import React, { createContext, useContext, useState, useEffect } from 'react';
import { Settings } from '../types';
import { DEFAULT_PRODUCTION_TEMPLATE } from '../lib/productionTemplate';
import { DEFAULT_SCENE_DURATION_SECONDS, positiveSceneDuration } from '../lib/sceneDuration';

const defaultSettings: Settings = {
  apiKey: '',
  model: 'gemini-3.1-pro-preview',
  defaultDuration: String(DEFAULT_SCENE_DURATION_SECONDS),
  defaultStyle: 'Educational',
  sceneDurationSeconds: DEFAULT_SCENE_DURATION_SECONDS,
  productionTemplate: DEFAULT_PRODUCTION_TEMPLATE,
  productionTemplateName: 'Modus Visual Production Handoff V2',
  showProductionDiagnostics: false,
};

interface SettingsContextType {
  settings: Settings;
  setSettings: (settings: Settings | ((prev: Settings) => Settings)) => void;
  isLoaded: boolean;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('assembly_line_settings');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSettings({
          ...defaultSettings,
          ...parsed,
          sceneDurationSeconds: positiveSceneDuration(parsed?.sceneDurationSeconds) ?? DEFAULT_SCENE_DURATION_SECONDS,
        });
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('assembly_line_settings', JSON.stringify(settings));
    }
  }, [settings, isLoaded]);

  return (
    <SettingsContext.Provider value={{ settings, setSettings, isLoaded }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
