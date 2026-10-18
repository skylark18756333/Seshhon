// Meet in the middle, in a live sesh: an on/off switch, off to start. Everyone who switches it on shares roughly where they are
// (rounded to about 500 m) for this sesh only, and the database answers with the venues that are fairest for
// everyone (migration 0037). Nobody's position is ever shown or sent back, only venues, and it is deleted when you
// tap stop, leave the sesh, or the sesh ends. Hidden until the migration has been run.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { meetShare, meetStop, meetVenues, type Meet, type Sesh } from './api';
import { Button } from './Parts';
import type { ApiError } from './session';
import { C, F, themed } from './theme';
import { distanceAway, findMe, hoursLine, type Venues } from './venues';

const MEET_MS = 15000;   // asked again this often while the sesh is open, so a mate's share shows up
const MEET_LIST = 4;

export default function MeetMiddle({ s, v, myVote, onVote }: { s: Sesh; v: Venues; myVote: string | null; onVote: (venue: string) => void }) {
  const [meet, setMeet] = useState<Meet | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const id = s.id;

  const failed = useCallback((e: ApiError) => { if (e && e.missing) setOff(true); else setNote((e && e.message) || 'Something went wrong. Try again.'); }, []);
  useEffect(() => {
    let gone = false;
    const ask = () => meetVenues(id).then((m) => { if (!gone) setMeet(m); }, (e: ApiError) => { if (!gone && e.missing) setOff(true); });
    ask();
    const t = setInterval(ask, MEET_MS);
    return () => { gone = true; clearInterval(t); };
  }, [id]);

  if (off || !meet) return null;

  const share = async () => {
    setBusy(true); setNote('');
    const at = await findMe(true, true);
    if (!at) { setBusy(false); setNote('Could not get your location, so nothing was shared.'); return; }
    await meetShare(id, at).then(setMeet, failed);
    setBusy(false);
  };
  const stop = () => { setBusy(true); setNote(''); meetStop(id).then(setMeet, failed).then(() => setBusy(false)); };

  const picks = meet.venues.map((x) => v.byId[x]).filter(Boolean).slice(0, MEET_LIST);
  const people = s.members.length;
  return (
    <View style={styles.card} testID="meet-middle">
      <View style={styles.row}>
        <Text style={[styles.title, styles.grow]}>Meet in the middle</Text>
        <Switch
          value={meet.mine} disabled={busy} onValueChange={(on) => (on ? share() : stop())} testID="meet-switch"
          accessibilityLabel="Meet in the middle" trackColor={{ false: C.trackLine, true: C.on }} thumbColor="#ffffff"
        />
      </View>
      <Text style={styles.small}>
        {meet.mine ? 'On: your rough location is used for this sesh only. Nobody sees it, only the venues it finds. Switch off and it is deleted straight away.'
          : 'Switch on to find venues halfway between you and your mates. It uses where you are (to about 500 m) for this sesh only. Nobody sees your location, and it is deleted when you switch off or the sesh ends.'}
      </Text>
      <Text style={styles.small} testID="meet-count"><Text style={styles.strong}>{meet.shared} of {people}</Text> {meet.shared === 1 ? 'has' : 'have'} it on.</Text>
      {picks.length ? (
        <View style={styles.list}>
          {picks.map((ven) => (
            <View key={ven.id} style={styles.row} testID={'meet-' + ven.id}>
              <View style={styles.grow}>
                <Text style={styles.name}>{ven.name}</Text>
                <Text style={styles.small}>{[ven.kind, hoursLine(ven), distanceAway(v, ven.id)].filter(Boolean).join(', ')}</Text>
              </View>
              {s.locked_venue ? null : (
                <Button small ghost={myVote !== ven.id} label={myVote === ven.id ? 'Your vote' : 'Vote'} testID={'meet-vote-' + ven.id} onPress={() => onVote(ven.id)} />
              )}
            </View>
          ))}
        </View>
      ) : meet.mine ? <Text style={styles.small} testID="meet-waiting">Once a mate switches it on too, the venues between you show here.</Text> : null}
      {note ? <Text style={styles.small}>{note}</Text> : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 8, borderWidth: 1, borderColor: C.line },
  title: { fontFamily: F.bodyBold, fontSize: 17, color: C.fg },
  name: { fontFamily: F.bodyBold, fontSize: 15, color: C.fg },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },
  strong: { fontFamily: F.bodyBold, color: C.fg },
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 }
}));
