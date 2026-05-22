import 'react-native-url-polyfill/auto';
import {
  createClient
} from '@supabase/supabase-js';

// I've built the URL using your Project ID correctly here:
const supabaseUrl = 'https://uysjqeiufmqfzbctvrmm.supabase.co';

// Your nano key (copied exactly from your message):
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5c2pxZWl1Zm1xZnpiY3R2cm1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NDc3NzAsImV4cCI6MjA5MzUyMzc3MH0.PeB0TRRZSorR5MrUaj_5R2X_OJ_DsgAIBU_PHQN9ftk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);