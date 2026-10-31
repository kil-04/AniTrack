import {useEffect, useState} from 'react';
import {WEB_REMINDERS_KEY, webRemindersEnabled} from '../lib/airing';

export default function BrowserNotifications() {
  const supported = typeof Notification !== 'undefined';
  const [permission,setPermission] = useState<NotificationPermission>(supported ? Notification.permission : 'denied');
  const [enabled,setEnabled] = useState(webRemindersEnabled);
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => { if (supported) setPermission(Notification.permission); setEnabled(webRemindersEnabled()); };
    window.addEventListener('focus',refresh);
    return () => window.removeEventListener('focus',refresh);
  }, [supported]);
  return <div>
    <p className="text-sm leading-relaxed text-ink-2">Get reminders for new episodes of shows on your Watching and Plan to watch lists while AniTrack is open.</p>
    <p className="mt-2 text-sm text-ink-3" role="status">{!supported ? 'This browser does not support episode notifications.' : enabled ? 'Episode reminders are enabled.' : permission === 'denied' ? 'Notifications are blocked. Allow them in your browser’s site settings to enable reminders.' : 'Episode reminders are off.'}</p>
    {supported && <button className="btn btn-secondary mt-4" disabled={busy || (!enabled && permission === 'denied')} onClick={async () => {
      if (enabled) {localStorage.setItem(WEB_REMINDERS_KEY,'off');setEnabled(false);return;}
      setBusy(true);
      try {
        const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        setPermission(result);
        if (result === 'granted') localStorage.setItem(WEB_REMINDERS_KEY,'on');
        setEnabled(webRemindersEnabled());
      } finally {setBusy(false);}
    }}>{enabled ? 'Turn reminders off' : busy ? 'Waiting for browser…' : 'Enable episode reminders'}</button>}
  </div>;
}
