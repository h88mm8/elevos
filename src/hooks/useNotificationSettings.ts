import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'notification_settings';

interface NotificationSettings {
  soundEnabled: boolean;
}

const defaultSettings: NotificationSettings = {
  soundEnabled: true,
};

export function useNotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('Failed to save notification settings:', e);
    }
  }, [settings]);

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, soundEnabled: enabled }));
  }, []);

  return {
    soundEnabled: settings.soundEnabled,
    setSoundEnabled,
  };
}
