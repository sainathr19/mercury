// Tracks whether the user has seen the "Private mode" intro. It's shown the FIRST
// time they enter stealth (tap the eye) and never again once they tap "Got it".

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'private-intro:seen';

export async function hasSeenPrivateIntro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markPrivateIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // best-effort — worst case the intro shows again next time
  }
}
