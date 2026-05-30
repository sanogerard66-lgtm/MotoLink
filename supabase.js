import { Platform } from 'react-native';

// react-native-url-polyfill is only needed on native (web has URL built in)
if (Platform.OS !== 'web') {
  require('react-native-url-polyfill/auto');
}

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uysjqeiufmqfzbctvrmm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5c2pxZWl1Zm1xZnpiY3R2cm1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NDc3NzAsImV4cCI6MjA5MzUyMzc3MH0.PeB0TRRZSorR5MrUaj_5R2X_OJ_DsgAIBU_PHQN9ftk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
