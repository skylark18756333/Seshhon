// In a browser (the test harness) there is no provider page to show: the pretend provider just sends the person straight back.
import { useEffect } from 'react';

export default function AgeWeb({ onReturn }: { url: string; onReturn: () => void; onClose: () => void }) {
  useEffect(() => { onReturn(); }, []);
  return null;
}
