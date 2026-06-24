/**
* MOTOLINK — Full Production App v6
* Features: Auth, Map, Trips, Ratings, MoMo Payment (USSD),
*           Driver Payment Setup, Trip Completion Flow,
*           Push Notifications, Smart Search, Session Persistence (fixed),
*           Wallet, Full Language Support, SOS, Trip History,
*           Surge Pricing, Driver Earnings, Promo Codes & Referrals
*/

import React, {
  useReducer,
  useEffect,
  useCallback,
  createContext,
  useContext,
  useRef,
  useState,
  useMemo
} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Linking,
  Keyboard,
  BackHandler,
  Animated,
  Dimensions,
  StatusBar,
  Platform,
  Modal,
  Image,
  Easing,
  AppState,
  PanResponder,
  KeyboardAvoidingView,
  Share
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView
} from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  supabase
} from './supabase';

// ── Web-safe conditional imports ──────────────────────────────────────────────
// These modules are native-only and will crash on web if imported at the top level.
// We stub them on web and only use real implementations on native.

let WebView = null;
if (Platform.OS !== 'web') {
  try {
    WebView = require('react-native-webview').WebView;
  } catch {}
}

let TaskManager = null;
if (Platform.OS !== 'web') {
  try {
    TaskManager = require('expo-task-manager');
  } catch {}
}

let Print = null;
if (Platform.OS !== 'web') {
  try {
    Print = require('expo-print');
  } catch {}
}

let Sharing = null;
if (Platform.OS !== 'web') {
  try {
    Sharing = require('expo-sharing');
  } catch {}
}

let ImagePicker = null;
if (Platform.OS !== 'web') {
  try {
    ImagePicker = require('expo-image-picker');
  } catch {}
}

let Network = null;
if (Platform.OS !== 'web') {
  try {
    Network = require('expo-network');
  } catch {}
}

// ── PressableScale — universal spring press micro-interaction ─────────────────
// Wraps any child with a spring scale-down-then-snap-back on press.
// Gisore's preferred "vibrant / addictive" interactivity pattern.
const PressableScale = ({ children, style, onPress, onLongPress, disabled, activeScale = 0.945, ...rest }) => {
  const anim = useRef(new Animated.Value(1)).current;
  const onPressIn  = () => Animated.spring(anim, { toValue: activeScale, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const onPressOut = () => Animated.spring(anim, { toValue: 1,           useNativeDriver: true, speed: 28, bounciness: 10 }).start();
  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale: anim }] }]}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
};

// ── GlassCard — reusable frosted glass surface ────────────────────────────────
// Uses CSS backdropFilter on web, falls back to opaque dark card on native.
const GlassCard = ({ children, style, glowColor, ...rest }) => {
  const webBlur = Platform.OS === 'web'
    ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }
    : {};
  const glow = glowColor
    ? { shadowColor: glowColor, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 20, elevation: 14 }
    : {};
  return (
    <View style={[{
      backgroundColor: C.glass,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: C.borderFaint,
      overflow: 'hidden',
      ...webBlur,
      ...glow,
    }, style]} {...rest}>
      {children}
    </View>
  );
};

// ── webStyle — apply extra CSS properties on web only ─────────────────────────
// Usage: style={[styles.foo, webStyle({ backdropFilter:'blur(12px)' })]}
const webStyle = (cssProps) => Platform.OS === 'web' ? cssProps : {};

// ErrorBoundary — inline implementation to avoid react-error-boundary dep issues on web
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props); this.state = {
      error: null
    };
  }
  static getDerivedStateFromError(error) {
    return {
      error
    };
  }
  componentDidCatch() {}
  render() {
    if (this.state.error) {
      return this.props.fallbackRender
      ? this.props.fallbackRender({
        error: this.state.error
      }): null;
    }
    return this.props.children;
  }
}

const {
  width,
  height
} = Dimensions.get('window');
const COMMISSION_RATE = 0.10;
const SURGE_MULTIPLIER = 1.5;
const PEAK_HOURS = [[7, 9], [17, 20]];
const SURGE_DEMAND_RATIO = 0.5;
const ADMIN_WHATSAPP = '+250796111433';
const SOS_SAFETY_NUMBER = '+250796111433';
const STORAGE_KEY = '@motolink_session_v6';
const FAVORITES_KEY = '@motolink_favorites';
const APP_VERSION = '1.0.0';
const MIN_REQUIRED_VERSION = '1.0.0';
const OFFLINE_TRIPS_KEY = '@motolink_offline_trips';
const OFFLINE_HISTORY_KEY = '@motolink_offline_history';
const SCHEDULED_NOTIFY_MIN = 15; // minutes before scheduled trip to notify drivers
const MAX_SCHEDULE_DAYS = 7;
const LEADERBOARD_BONUS = 500; // FRW bonus for weekly top driver

// ── Surge pricing calculator ───────────────────
const isSurgePeakHour = () => {
  const hour = new Date().getHours();
  return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end);
};

const getSurgeMultiplier = async () => {
  try {
    // Time-based check
    if (isSurgePeakHour()) return SURGE_MULTIPLIER;
    // Demand-based check
    const [{
      count: searchingPassengers
    },
      {
        count: activeDrivers
      }] = await Promise.all([
        supabase.from('trips').select('*', {
          count: 'exact', head: true
        }).eq('status', 'searching'),
        supabase.from('profiles').select('*', {
          count: 'exact', head: true
        }).eq('role', 'driver').eq('is_suspended', false),
      ]);
    const ratio = (activeDrivers || 0) / Math.max(searchingPassengers || 0, 1);
    if (ratio < SURGE_DEMAND_RATIO && (searchingPassengers || 0) > 2) return SURGE_MULTIPLIER;
    return 1.0;
  } catch {
    return 1.0;
  }
};

const calcFareWithSurge = (distStr, multiplier = 1.0) => {
  const base = calcFare(distStr);
  return Math.round(base * multiplier);
};

// Generate unique 6-char referral code
const genReferralCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'ML-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

// ══════════════════════════════════════════════
// 1. BACKGROUND TASK
// ══════════════════════════════════════════════
// Push notifications (remote) were removed from Expo Go in SDK 53+.
// Guard all remote-push code so the app doesn't crash during development.
const IS_EXPO_GO = Constants.appOwnership === 'expo';

const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND-NOTIFICATION-TASK';

if (!IS_EXPO_GO && Platform.OS !== 'web' && TaskManager) {
  TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, ({
    data, error
  }) => {
    if (error) {
      console.error('BG task:', error); return;
    }
  });
  Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {});
}

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: !IS_EXPO_GO,
    }),
  });
}

// ══════════════════════════════════════════════
// 2. DESIGN TOKENS — Premium Dark Luxury
// ══════════════════════════════════════════════
const C = {
  // ── Deep layered base (never plain black) ─────────────────────────────────
  black:       '#06060F',
  charcoal:    '#0B0B18',
  card:        '#10101E',
  card2:       '#181828',
  card3:       '#1F1F32',

  // ── Luminous gold — the brand soul ────────────────────────────────────────
  gold:        '#D4AF37',
  goldBright:  '#F0C93A',
  goldDim:     'rgba(212,175,55,0.12)',
  goldGlow:    'rgba(212,175,55,0.28)',
  goldGlow2:   'rgba(212,175,55,0.55)',  // strong CTA glow
  goldNeon:    'rgba(212,175,55,0.06)',  // ultra-faint tint

  // ── Text ──────────────────────────────────────────────────────────────────
  white:       '#FFFFFF',
  offWhite:    '#E8EAF6',
  gray:        '#8E8EAA',
  grayDark:    '#42425E',

  // ── True glassmorphism surfaces ───────────────────────────────────────────
  // The "glass layer" is always white/light at low opacity over a dark base.
  glass:       'rgba(255,255,255,0.06)',   // default card surface
  glassLight:  'rgba(255,255,255,0.10)',   // elevated / hovered surface
  glassMid:    'rgba(255,255,255,0.04)',   // subtle tint
  glassDeep:   'rgba(8,8,20,0.94)',        // modal/sheet backdrop
  glassInput:  'rgba(255,255,255,0.05)',   // input field surface

  // ── Borders — the rim-light effect is key to glass ───────────────────────
  border:      'rgba(212,175,55,0.20)',    // gold rim (cards/panels)
  borderFaint: 'rgba(255,255,255,0.10)',   // white rim (glass effect)
  borderGlow:  'rgba(212,175,55,0.45)',    // bright gold (active/focused)
  borderBright:'rgba(212,175,55,0.55)',

  // ── Status — vibrant, used only on interactive elements ───────────────────
  red:         '#FF4560',
  redDim:      'rgba(255,69,96,0.12)',
  green:       '#00D97E',
  greenDim:    'rgba(0,217,126,0.12)',
  blue:        '#3D8EF8',
  blueDim:     'rgba(61,142,248,0.12)',
  orange:      '#FF9F40',
  orangeDim:   'rgba(255,159,64,0.12)',
  purple:      '#A855F7',
  purpleDim:   'rgba(168,85,247,0.12)',

  // ── Brand payments ─────────────────────────────────────────────────────────
  mtn:         '#FFCC00',
  airtel:      '#FF4444',

  // ── Gradient stops ────────────────────────────────────────────────────────
  gradStart:   '#D4AF37',
  gradEnd:     '#F0C93A',
};


// ══════════════════════════════════════════════
// 3. FULL LANGUAGE STRINGS — all 3 languages
//    Every UI string defined here — no hardcoded English
// ══════════════════════════════════════════════
const LANG = {
  en: {
    // Auth
    welcome: 'Welcome to MotoLink',
    slogan: 'The Future of Ride-Hailing',
    signIn: 'Sign In',
    signUp: 'Sign Up',
    phone: 'Phone Number',
    pass: 'Password',
    confirmPass: 'Confirm Password',
    name: 'Full Name',
    driver: 'Driver',
    pax: 'Passenger',
    newAcc: 'New user? Join MotoLink',
    hasAcc: 'Already a member? Sign in',
    passMatch: '✓ Passwords match',
    passMismatch: '✗ Passwords do not match',
    // App
    driverDash: 'DRIVER DASH',
    myRequests: 'Your Requests',
    noRequests: 'No active requests yet.',
    searchWhere: 'Where to? (e.g. Remera, Bus Park)',
    searchHint: 'Search your destination above to begin.',
    scanJobs: 'Scanning for nearby requests...',
    availJobs: 'Available Jobs',
    // Trip status
    pending: '⏳ PENDING DRIVER',
    accepted: '✅ ACCEPTED',
    sentAt: 'Sent',
    acceptedAt: 'Accepted',
    cancelledAt: 'Cancelled',
    requestedAt: 'Requested',
    from: 'From',
    to: 'To',
    // Payment
    payWith: 'Pay with',
    cash: '💵 Cash',
    momoTap: '📲 MoMo Tap',
    walletPay: '💳 Wallet',
    choosePayment: 'Choose Payment Method',
    paymentInfo: 'Driver Payment Info',
    payMerchant: 'Pay via Merchant Code',
    payMomo: 'Pay via MoMo Number',
    tapToPay: 'Tap to pay',
    paidBtn: "I've Paid ✓",
    confirmReceived: 'Confirm Payment Received',
    paymentReceived: 'Payment Received ✓',
    // Driver payment setup
    paymentSetup: 'Payment Setup',
    momoType: 'Account Type',
    personal: 'Personal MoMo',
    merchant: 'Merchant Code',
    momoNumber: 'MoMo Number',
    merchantCode: 'Merchant Code',
    accountHolder: 'Account Holder Name',
    savePayment: 'Save Payment Info',
    paymentRequired: 'Add your payment details so passengers can pay you.',
    noPaymentWarning: '⚠️ Set up payment info to accept trips',
    // Completion flow
    arrivedBtn: 'Arrived — Request Completion',
    completionRequested: 'Driver has arrived! Confirm to proceed.',
    confirmComplete: 'Confirm Trip Complete',
    driverConfirm: 'Confirm Payment Received',
    awaitingPayment: 'Awaiting passenger payment...',
    awaitingDriverConfirm: 'Awaiting driver confirmation...',
    // Profile
    settings: 'Profile Setup',
    save: 'Save Profile',
    signOut: 'Sign Out',
    deleteAcc: 'Delete Account',
    // Wallet
    wallet: 'My Wallet',
    topUp: 'Top Up',
    txHistory: 'History',
    walletHidden: 'Wallet payments coming soon via MTN/Airtel API.',
    // Rating
    rateTrip: 'Rate Your Trip',
    skipRating: 'Skip for now',
    submitRating: 'Submit Rating',
    // Misc
    loading: 'Loading...',
    retry: 'Retry',
    close: 'Close',
    cancel: 'Cancel',
    km: 'km away',
    callDriver: '📞 Call Driver',
    callPassenger: '📞 Call Passenger',
    fareLabel: 'Fare',
    activeJob: '🚦 Active Mission',
    pickupAt: 'Pick up at',
    cancelTrip: 'CANCEL',
    completeTrip: 'COMPLETE',
    poor: '😞 Poor',
    fair: '😐 Fair',
    good: '🙂 Good',
    great: '😊 Great',
    excellent: '🤩 Excellent!',
    tapStar: 'Tap a star to rate',
    reviewPlaceholder: 'Leave a comment (optional)...',
    // SOS
    sos: 'SOS',
    sosTitle: '🚨 Emergency SOS',
    sosConfirm: 'This will immediately call MotoLink safety, send your GPS location via WhatsApp, and alert your emergency contact.',
    sosSend: 'SEND SOS NOW',
    sosCancel: 'Cancel — I\'m Safe',
    sosActivated: '🚨 SOS Activated',
    sosSent: 'Safety team and emergency contact notified. Help is on the way.',
    emergencyContact: 'Emergency Contact',
    emergencyName: 'Contact Name',
    emergencyPhone: 'Contact Phone',
    addEmergency: 'Add Emergency Contact',
    // Trip History
    tripHistory: 'Trip History',
    noHistory: 'No trips yet.',
    loadMore: 'Load More',
    receipt: 'Receipt',
    shareWhatsApp: 'Share via WhatsApp',
    downloadPDF: 'Download PDF',
    earnings: 'Earnings',
    totalEarnings: 'Total Earnings',
    totalTrips: 'Total Trips',
    tripId: 'Trip ID',
    commission: 'Commission (10%)',
    driverEarnings: 'Driver Earnings',
    ratingGiven: 'Rating Given',
    notRated: 'Not rated',
    viewReceipt: 'View Receipt',
    // Surge
    surgeActive: '⚡ Surge Pricing Active',
    surgeReason: 'High demand or peak hours',
    surge1_5x: '1.5× fare applies',
    surgeWarning: '⚡ Surge pricing is active (1.5×). Fare is higher than usual due to high demand.',
    // Earnings dashboard
    earningsDash: 'Earnings Dashboard',
    today: 'Today',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    allTime: 'All Time',
    tripsCompleted: 'Trips Completed',
    avgPerTrip: 'Avg Per Trip',
    peakDay: 'Best Day',
    noEarnings: 'No completed trips yet.',
    // Promo & Referral
    promoCode: 'Promo Code',
    applyCode: 'Apply',
    promoApplied: '🎉 Promo Applied!',
    promoInvalid: 'Invalid or expired promo code.',
    promoUsed: 'You have already used this code.',
    promoSaved: 'saved on this ride',
    referralCode: 'Your Referral Code',
    referralShare: 'Share & Earn',
    referralInfo: 'Share your code. Earn 200 FRW for every driver who signs up with it.',
    referralEarned: 'Referral Earnings',
    enterRefCode: 'Have a referral code? (optional)',
    // Scheduled Rides
    scheduleRide: 'Schedule a Ride',
    scheduledFor: 'Scheduled for',
    scheduleDate: 'Select Date & Time',
    upcomingRides: 'Upcoming Rides',
    scheduleNow: 'Book Now',
    scheduleLater: 'Schedule for Later',
    inMinutes: 'in',
    scheduledTrip: '📅 Scheduled Trip',
    preAccept: 'Pre-Accept This Trip',
    preAccepted: '✋ Pre-Accepted',
    preAcceptedBy: 'Reserved by',
    preAcceptCancel: 'Cancel Pre-Accept',
    scheduledReminder: '⏰ Scheduled Trip Reminder',
    scheduledReminderBody: 'Your scheduled trip starts in',
    scheduledReminderDriver: 'Your pre-accepted trip starts in',
    tripStartBoth: 'Trip Starting Soon',
    paymentPopup: '💳 Payment Required',
    paymentAmount: 'Amount to Pay',
    payViaCash: '💵 Pay with Cash',
    payViaMoMo: '📲 Pay via MoMo',
    paymentDone: '✅ Payment Confirmed',
    driverWaiting: 'Driver is waiting for payment confirmation',
    passengerPaid: 'Passenger has paid',
    tripCompleteSuccess: '🎉 Trip Completed!',
    tripCompleteBody: 'Thank you for using MotoLink.',
    requestSent: '🛵 Request Sent!',
    requestSentBody: 'Searching for a nearby driver...',
    nearbyRequest: '📍 New Nearby Request',
    goBack: 'Go Back',
    minimize: 'Minimize',
    // Multi-stop
    addStop: '+ Add Stop',
    removeStop: 'Remove',
    stop: 'Stop',
    stops: 'Stops',
    markReached: 'Mark Stop Reached ✓',
    nextStop: 'Next Stop',
    allStopsReached: 'All stops reached!',
    // Package delivery
    deliveryMode: 'Package Delivery',
    rideMode: 'Ride',
    packageDesc: 'Package Description',
    recipientName: 'Recipient Name',
    recipientPhone: 'Recipient Phone',
    pickedUp: 'Mark as Picked Up 📦',
    delivered: 'Mark as Delivered ✓',
    takePhoto: 'Take Delivery Photo',
    deliveryStatus: 'Delivery Status',
    pending_del: '⏳ Pending Pickup',
    pickedUp_del: '📦 Picked Up',
    delivered_del: '✅ Delivered',
    // B2B
    business: 'Business Account',
    joinCompany: 'Join a Company',
    companyCode: 'Company Code',
    companyName: 'Company Name',
    rdbNumber: 'RDB Number',
    billingInvoice: 'Monthly Invoice',
    billingWallet: 'Company Wallet',
    employeeRides: 'Employee Rides',
    monthlySpend: 'Monthly Spend',
    // Leaderboard
    leaderboard: '🏆 Weekly Leaderboard',
    topDrivers: 'Top Drivers This Week',
    yourRank: 'Your Rank',
    // Offline
    offlineMode: '📡 Offline Mode',
    offlineMsg: 'No internet connection. Using cached data.',
    queuedRequest: 'Ride request queued — will send when online.',
    // ── In-app notification strings ──
    notif_wrongCreds: 'Incorrect phone number or password. Please try again.',
    notif_noPhone: 'Please enter your phone number.',
    notif_noPass: 'Please enter your password.',
    notif_noName: 'Please enter your full name.',
    notif_passMismatch2: 'Passwords do not match. Please check and retry.',
    notif_passShort: 'Password must be at least 6 characters.',
    notif_phoneExists: 'This phone number is already registered. Sign in instead.',
    notif_allFields: 'Please fill in all required fields.',
    notif_noInternet: 'No internet connection. Please check your network.',
    notif_backOnline: 'Back online! Your queued requests have been sent.',
    notif_locDenied: 'Location access denied. Enable it in Settings to use MotoLink.',
    notif_locOff: 'Location services are off. Please turn on GPS.',
    notif_locGranted: '📍 Location found. Welcome to MotoLink!',
    notif_mapPin: '📌 Destination pinned on map. Long-press anywhere to change it.',
    notif_searchFail: 'Could not find that place. Try a different search term.',
    notif_noGPS: 'Waiting for your GPS location...',
    notif_profileSaved: 'Profile saved successfully.',
    notif_paySetupDone: 'Payment info saved! You can now accept trips.',
    notif_promoInvalid: 'Invalid or expired promo code.',
    notif_promoUsed: 'You have already used this promo code.',
    notif_promoOk: 'Promo code applied! Discount added to your fare.',
    notif_scheduleNoTime: 'Please select a date and time for your ride.',
    notif_schedulePast: 'Please choose a future time for your ride.',
    notif_rideQueued: 'No connection — ride queued for when you\'re online.',
    notif_signupOk: 'Welcome to MotoLink! Your account is ready.',
    notif_signoutOk: 'Signed out successfully. See you soon!',
    notif_deleteOk: 'Account deleted. Sorry to see you go.',
    notif_sosTitle: '🚨 SOS Sent',
    notif_sosSent: 'Safety team notified. Help is on the way.',
    notif_cameraOff: 'Camera access denied. Enable it in Settings.',
    // Airtel Money
    airtelMoney: 'Airtel Money',
    airtelNumber: 'Airtel Money Number',
    payViaAirtel: '📲 Pay via Airtel Money',
    passengerPaySource: 'Your payment account',
    payWithMTN: '📲 MTN MoMo',
    payWithAirtel: '📲 Airtel Money',
    driverAirtelNum: 'Driver Airtel Number',
    noDriverPayment: 'Driver has not set up any payment account.',
    ussdInstructions: 'Dial this USSD code to pay, then tap Confirm below.',
    driverReceives: 'Driver receives via',
    // Favorites management
    savedPlaces: '⭐ Saved Places',
    home: 'Home',
    work: 'Work',
    fav1: 'Favourite 1',
    fav2: 'Favourite 2',
    manualEntry: '✏️ Type Address',
    pickFromSearch: '🔍 Pick from Search',
    deleteFav: 'Delete',
    savePlace: 'Save',
    searchPlaceholder: 'Search address...',
    savedOk: 'Saved!',
    deleteOk: 'Deleted.',
    noAddress: 'No address set',
    manualAddressHint: 'Type the address manually:',
    // TOS content
    tos_title: 'Terms of Service & Privacy Policy',
    tos_agree: '✓ I AGREE — CONTINUE',
    tos_readPrivacy: 'Read full Privacy Policy',
    tos_s1_title: '1. Acceptance of Terms',
    tos_s1_body: 'By using MotoLink, you agree to these Terms of Service. MotoLink is a technology platform that connects passengers with motorcycle taxi drivers in Rwanda. We are not a transportation company.',
    tos_s2_title: '2. User Responsibilities',
    tos_s2_body: 'You must be 16 or older to use MotoLink. You are responsible for all activity under your account. You agree not to use the platform for unlawful purposes.',
    tos_s3_title: '3. Payments',
    tos_s3_body: 'Fares are calculated based on distance. MotoLink charges a 10% platform fee on driver earnings. All payments are processed through MTN MoMo, Airtel Money, or cash as agreed.',
    tos_s4_title: '4. Safety',
    tos_s4_body: 'MotoLink provides an SOS feature for emergencies. Drivers must hold a valid motorcycle licence. Passengers are responsible for wearing helmets provided by drivers.',
    tos_s5_title: '5. Privacy',
    tos_s5_body: 'We collect your name, phone number, and location data to provide our services. Your location is only shared with your matched driver during an active trip. We never sell your personal data to third parties. Data is stored securely on Supabase servers in compliance with Rwanda\'s data protection guidelines.',
    tos_s6_title: '6. Cancellations',
    tos_s6_body: 'Passengers may cancel a trip before a driver accepts for free. Repeated cancellations after acceptance may result in account restrictions.',
    tos_s7_title: '7. Contact',
    tos_s7_body: 'For support: WhatsApp +250 788 000 000 or email support@motolink.rw',
    // Privacy policy content
    privacy_title: 'Privacy Policy',
    privacy_updated: 'Last updated: June 2025',
    privacy_s1_title: 'Data We Collect',
    privacy_s1_body: '• Full name and phone number (required for account)\n• GPS location (during active sessions only)\n• Trip history (pickup, destination, fare, timestamps)\n• Device information (OS version, app version)\n• Payment method selection (we never store MoMo or Airtel PINs)',
    privacy_s2_title: 'How We Use Your Data',
    privacy_s2_body: '• Matching passengers with nearby drivers\n• Calculating fares based on GPS distance\n• Processing MoMo and Airtel Money payments via USSD\n• Sending trip notifications\n• Improving app performance and safety',
    privacy_s3_title: 'Data Sharing',
    privacy_s3_body: 'Your name and phone are shared with your matched driver during trips only. We never sell data. We may share anonymised aggregated data for traffic analysis.',
    privacy_s4_title: 'Your Rights',
    privacy_s4_body: 'You may request deletion of your account and all associated data at any time via Settings → Delete Account.',
    privacy_s5_title: 'Contact',
    privacy_s5_body: 'privacy@motolink.rw',
    // Legal link labels
    termsOfService: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    deleteAccWarning: 'This will permanently delete your account, all trip history, and remove your data from MotoLink.',
    deleteAccIrreversible: 'This action cannot be undone.',
    deleteAccConfirm: 'Yes, Delete My Account',
    goBack: '← Back',
    acceptBtnLabel: 'ACCEPT',
    findingDriver: 'Finding Driver...',
    activeTripFound: 'Active trip restored',
  },

  rw: {
    welcome: 'Murakaza neza kuri MotoLink',
    slogan: 'Ikoranabuhanga mu Gutwara Abantu',
    signIn: 'Injira',
    signUp: 'Iyandikishe',
    phone: 'Numero ya Telefone',
    pass: 'Ijambo ry\'Ibanga',
    confirmPass: 'Emeza Ijambo ry\'Ibanga',
    name: 'Amazina Yombi',
    driver: 'Umushoferi',
    pax: 'Umugenzi',
    newAcc: 'Nta konti ufite? Iyandikishe',
    hasAcc: 'Usanzwe ufite konti? Injira',
    passMatch: '✓ Amagambo y\'ibanga arahuye',
    passMismatch: '✗ Amagambo y\'ibanga ntahuye',
    driverDash: 'IKIBAHO CY\'UMUSHOFERI',
    myRequests: 'Ibisabwa Byawe',
    noRequests: 'Nta bisabwa bihari.',
    searchWhere: 'Urajya he? (urugero: Remera, Bus Park)',
    searchHint: 'Shakisha aho ujya hejuru gutangira.',
    scanJobs: 'Gushakisha ibisabwa biri hafi...',
    availJobs: 'Imirimo Iboneka',
    pending: '⏳ GUTEGEREZA UMUSHOFERI',
    accepted: '✅ BYAREMEJWE',
    sentAt: 'Byoherejwe',
    acceptedAt: 'Byaremejwe',
    cancelledAt: 'Byahagaritswe',
    requestedAt: 'Byasabwe',
    from: 'Uvuye',
    to: 'Ujya',
    payWith: 'Ishyura ukoresheje',
    cash: '💵 Amafaranga y\'Ntanganwa',
    momoTap: '📲 MoMo',
    walletPay: '💳 Amafaranga y\'Imbaho',
    choosePayment: 'Hitamo Uburyo bwo Kwishyura',
    paymentInfo: 'Amakuru y\'Ubwishyu bw\'Umushoferi',
    payMerchant: 'Ishyura ukoresheje Kode ya Muguzi',
    payMomo: 'Ishyura ukoresheje Numero ya MoMo',
    tapToPay: 'Kanda wishyure',
    paidBtn: 'Narishye ✓',
    confirmReceived: 'Emeza ko Wahawe Amafaranga',
    paymentReceived: 'Amafaranga Yabonywe ✓',
    paymentSetup: 'Gushyiraho Uburyo bw\'Ubwishyu',
    momoType: 'Ubwoko bw\'Konti',
    personal: 'MoMo Bwite',
    merchant: 'Kode ya Muguzi',
    momoNumber: 'Numero ya MoMo',
    merchantCode: 'Kode ya Muguzi',
    accountHolder: 'Izina ry\'Nyirakonti',
    savePayment: 'Bika Amakuru y\'Ubwishyu',
    paymentRequired: 'Ongeraho amakuru y\'ubwishyu kugira ngo abagenzi bakurihe.',
    noPaymentWarning: '⚠️ Shyiraho amakuru y\'ubwishyu mbere yo kwakira inzira',
    arrivedBtn: 'Nageze — Saba Gusoza Urugendo',
    completionRequested: 'Umushoferi arageze! Emeza ukomeze.',
    confirmComplete: 'Emeza ko Urugendo Rusojwe',
    driverConfirm: 'Emeza ko Wahawe Amafaranga',
    awaitingPayment: 'Gutegereza ubwishyu bw\'umugenzi...',
    awaitingDriverConfirm: 'Gutegereza kwemeza kw\'umushoferi...',
    settings: 'Umwirondoro Wawe',
    save: 'Bika Umwirondoro',
    signOut: 'Sohoka',
    deleteAcc: 'Siba Konti',
    wallet: 'Amafaranga Yanjye',
    topUp: 'Shyiramo Amafaranga',
    txHistory: 'Amateka',
    walletHidden: 'Ubwishyu bw\'imbaho buzaza vuba.',
    rateTrip: 'Shyiraho Amanota y\'Urugendo',
    skipRating: 'Reka ubu',
    submitRating: 'Ohereza Amanota',
    loading: 'Gutegereza...',
    retry: 'Ongera ugerageze',
    close: 'Funga',
    cancel: 'Hagarika',
    km: 'km intera',
    callDriver: '📞 Hamagara Umushoferi',
    callPassenger: '📞 Hamagara Umugenzi',
    fareLabel: 'Igiciro',
    activeJob: '🚦 Akazi Gakora',
    pickupAt: 'Gafata umugenzi',
    cancelTrip: 'HAGARIKA',
    completeTrip: 'SOZA',
    poor: '😞 Nabi cyane',
    fair: '😐 Nabi',
    good: '🙂 Byiza',
    great: '😊 Byiza cyane',
    excellent: '🤩 Birahebeje!',
    tapStar: 'Kanda inyenyeri usuzume',
    reviewPlaceholder: 'Siga igitekerezo (ntibisabwa)...',
    sos: 'SOS',
    sosTitle: '🚨 Ubufasha bwa Ngombwa',
    sosConfirm: 'Iki kizatuma hahamagarwa itsinda ry\'umutekano rya MotoLink, kohereza aho uri kuri WhatsApp, no kumenyesha uwo mwegereye mu bihe by\'ingorane.',
    sosSend: 'OHEREZA SOS NONAHA',
    sosCancel: 'Hagarika — Ndi Muri Amahoro',
    sosActivated: '🚨 SOS Yoherejwe',
    sosSent: 'Itsinda ry\'umutekano n\'uwo mwegereye bamenyeshejwe. Ubufasha buragenda.',
    emergencyContact: 'Uwo Mwegereye mu Bihe by\'Ingorane',
    emergencyName: 'Izina ry\'Uwo Mwegereye',
    emergencyPhone: 'Telefone y\'Uwo Mwegereye',
    addEmergency: 'Ongeraho Uwo Mwegereye',
    tripHistory: 'Amateka y\'Inzira',
    noHistory: 'Nta nzira zakorwe.',
    loadMore: 'Shyiraho ibindi',
    receipt: 'Icyemezo cy\'Urugendo',
    shareWhatsApp: 'Ohereza kuri WhatsApp',
    downloadPDF: 'Manura PDF',
    earnings: 'Inyemezabwishyu',
    totalEarnings: 'Amafaranga Yose Yabonetse',
    totalTrips: 'Inzira Zose Zakorwe',
    tripId: 'Nomero y\'Urugendo',
    commission: 'Igice cya Sosiyete (10%)',
    driverEarnings: 'Amafaranga y\'Umushoferi',
    ratingGiven: 'Amanota Yatanzwe',
    notRated: 'Ntiyasuzumwe',
    viewReceipt: 'Reba Icyemezo',
    surgeActive: '⚡ Igiciro Kiriyongereye',
    surgeReason: 'Abakozi bake cyangwa amasaha y\'isoko',
    surge1_5x: 'Igiciro kiriyongereye 1.5×',
    surgeWarning: '⚡ Igiciro kiriyongereye (1.5×). Igiciro ni kinini kuruta igisanzwe kubera abakoresha benshi.',
    earningsDash: 'Ikibaho cy\'Inyemezabwishyu',
    today: 'Uyu Munsi',
    thisWeek: 'Iki Cyumweru',
    thisMonth: 'Uyu Mwezi',
    allTime: 'Ibihe Byose',
    tripsCompleted: 'Inzira Zarangiye',
    avgPerTrip: 'Hagati ku Nzira',
    peakDay: 'Umunsi Mwiza Cyane',
    noEarnings: 'Nta nzira zarangiye.',
    promoCode: 'Kode ya Promo',
    applyCode: 'Shyiraho',
    promoApplied: '🎉 Promo Yashyizweho!',
    promoInvalid: 'Kode ntibaho cyangwa yarangiye.',
    promoUsed: 'Warakoresheje kode iyi mbere.',
    promoSaved: 'byakuwe ku giciro cy\'urugendo',
    referralCode: 'Kode Yawe yo Gutumira',
    referralShare: 'Sangira no Gunguka',
    referralInfo: 'Sangira kode yawe. Unguke amafaranga 200 FRW buri mushoferi wiyandikisha nazo.',
    referralEarned: 'Amafaranga y\'Abatumiwe',
    enterRefCode: 'Ufite kode yo gutumira? (ntibisabwa)',
    scheduleRide: 'Teganya Urugendo',
    scheduledFor: 'Guteganyirizwa',
    scheduleDate: 'Hitamo Itariki na Saa',
    upcomingRides: 'Inzira Ziteganyirijwe',
    scheduleNow: 'Saba Nonaha',
    scheduleLater: 'Teganya Gukurikira',
    inMinutes: 'mu',
    scheduledTrip: '📅 Urugendo Ruteganyirijwe',
    preAccept: 'Emeza Urugendo Uru Mbere y\'Igihe',
    preAccepted: '✋ Byaremejwe Mbere y\'Igihe',
    preAcceptedBy: 'Byabitswe na',
    preAcceptCancel: 'Hagarika Kwemeza Mbere y\'Igihe',
    scheduledReminder: '⏰ Urugendo Ruteganyirijwe Rurenga',
    scheduledReminderBody: 'Urugendo ruteganyirijwe rutangira mu minota',
    scheduledReminderDriver: 'Urugendo wemeye rutangira mu minota',
    tripStartBoth: 'Urugendo Rutangira Vuba',
    paymentPopup: '💳 Ubwishyu Busabwa',
    paymentAmount: 'Amafaranga yo Kwishyura',
    payViaCash: '💵 Ishyura n\'Amafaranga y\'Ntanganwa',
    payViaMoMo: '📲 Ishyura ukoresheje MoMo',
    paymentDone: '✅ Ubwishyu Bwaremejwe',
    driverWaiting: 'Umushoferi ategereza kwemezwa kw\'ubwishyu',
    passengerPaid: 'Umugenzi yarishye',
    tripCompleteSuccess: '🎉 Urugendo Rwarangiye!',
    tripCompleteBody: 'Urakoze gukoresha MotoLink.',
    requestSent: '🛵 Isaba Ryoherejwe!',
    requestSentBody: 'Gushakisha umushoferi wo hafi...',
    nearbyRequest: '📍 Isaba Rishya Riri Hafi',
    goBack: 'Subira Inyuma',
    minimize: 'Gabanya',
    addStop: '+ Ongeraho Ahantu',
    removeStop: 'Siba',
    stop: 'Ahantu',
    stops: 'Aho Hatumiwe',
    markReached: 'Emeza ko Wageze Hano ✓',
    nextStop: 'Ahantu Hakurikira',
    allStopsReached: 'Wageze ahantu hose!',
    deliveryMode: 'Kohereza Impahurwa',
    rideMode: 'Urugendo',
    packageDesc: 'Ibisobanuro by\'Impahurwa',
    recipientName: 'Izina ry\'Uwakiriye',
    recipientPhone: 'Telefone y\'Uwakiriye',
    pickedUp: 'Emeza ko Wafashe Impahurwa 📦',
    delivered: 'Emeza ko Wahaye Impahurwa ✓',
    takePhoto: 'Fata Ifoto y\'Igendezo',
    deliveryStatus: 'Uko Kohereza Bigenda',
    pending_del: '⏳ Gutegereza Gufatwa',
    pickedUp_del: '📦 Impahurwa Yafashwe',
    delivered_del: '✅ Impahurwa Yahaye',
    business: 'Konti ya Sosiyete',
    joinCompany: 'Injira muri Sosiyete',
    companyCode: 'Kode ya Sosiyete',
    companyName: 'Izina rya Sosiyete',
    rdbNumber: 'Numero ya RDB',
    billingInvoice: 'Fagitire ya Buri Kwezi',
    billingWallet: 'Amafaranga ya Sosiyete',
    employeeRides: 'Inzira z\'Abakozi',
    monthlySpend: 'Amafaranga y\'Ukwezi',
    leaderboard: '🏆 Urutonde rw\'Abakomeye',
    topDrivers: 'Abashofer Bakomeye Cyane Iki Cyumweru',
    yourRank: 'Aho Uri mu Rutonde',
    offlineMode: '📡 Nta Murandasi',
    offlineMsg: 'Nta murandasi. Ukoresha amakuru yabitswe.',
    queuedRequest: 'Isaba ryategerejwe — rizohererezwa mugihe murandasi uboneka.',
    notif_wrongCreds: 'Numero ya telefone cyangwa ijambo ry\'ibanga ntabwo ari ryo. Ongera ugerageze.',
    notif_noPhone: 'Shyiraho numero yawe ya telefone.',
    notif_noPass: 'Shyiraho ijambo ryawe ry\'ibanga.',
    notif_noName: 'Shyiraho amazina yawe yombi.',
    notif_passMismatch2: 'Amagambo y\'ibanga ntahuye. Reba hanyuma ugerageze.',
    notif_passShort: 'Ijambo ry\'ibanga rigomba kuba nibura inyuguti 6.',
    notif_phoneExists: 'Iyi numero isanzwe yiyandikishije. Injira.',
    notif_allFields: 'Uzuza ibice byose bisabwa.',
    notif_noInternet: 'Nta murandasi. Reba iyunganira ryawe.',
    notif_backOnline: 'Wasubiye kuri murandasi! Ibisabwa byawe birahererejwe.',
    notif_locDenied: 'Uruhushya rwo kumenya aho uri rwanzwe. Shyiraho muri Igenamiterere.',
    notif_locOff: 'Serivisi za GPS zifunze. Fungura GPS yawe.',
    notif_locGranted: '📍 Aho uri babonye. Murakaza neza kuri MotoLink!',
    notif_mapPin: '📌 Intego yahagijwe ku ikarita. Fata igihe kirekire guhindura.',
    notif_searchFail: 'Aho washakaga ntiboneka. Gerageza amagambo ahindutse.',
    notif_noGPS: 'Gutegereza GPS yawe...',
    notif_profileSaved: 'Umwirondoro wabitswe neza.',
    notif_paySetupDone: 'Amakuru y\'ubwishyu yabitswe! Ubu urashobora kwakira inzira.',
    notif_promoInvalid: 'Kode ya promo ntibaho cyangwa yarangiye.',
    notif_promoUsed: 'Warakoresheje kode iyi mbere.',
    notif_promoOk: 'Kode ya promo yashyizweho! Igabanyizo ryongewe ku giciro.',
    notif_scheduleNoTime: 'Hitamo itariki n\'amasaa y\'urugendo rwawe.',
    notif_schedulePast: 'Hitamo igihe kizaza k\'urugendo rwawe.',
    notif_rideQueued: 'Nta murandasi — isaba ryategerejwe kugeza murandasi uboneka.',
    notif_signupOk: 'Murakaza neza kuri MotoLink! Konti yawe iteguye.',
    notif_signoutOk: 'Wasohutse neza. Tuzabonana!',
    notif_deleteOk: 'Konti yasibwe neza.',
    notif_sosTitle: '🚨 SOS Yoherejwe',
    notif_sosSent: 'Itsinda ry\'umutekano ryamenyeshejwe. Ubufasha buragenda.',
    notif_cameraOff: 'Uruhushya rwa kamera rwanzwe. Shyiraho muri Igenamiterere.',
    // Airtel Money
    airtelMoney: 'Airtel Money',
    airtelNumber: 'Numero ya Airtel Money',
    payViaAirtel: '📲 Ishyura ukoresheje Airtel Money',
    passengerPaySource: 'Konti yawe yo kwishyura',
    payWithMTN: '📲 MTN MoMo',
    payWithAirtel: '📲 Airtel Money',
    driverAirtelNum: 'Numero ya Airtel y\'Umushoferi',
    noDriverPayment: 'Umushoferi ntashyizeho konti y\'ubwishyu.',
    ussdInstructions: 'Kora kode USSD wishyure, hanyuma ukande Emeza hepfo.',
    driverReceives: 'Umushoferi akira binyuze',
    // Favorites management
    savedPlaces: '⭐ Aho Habitswe',
    home: 'Urugo',
    work: 'Akazi',
    fav1: 'Ahantu Ha 1',
    fav2: 'Ahantu Ha 2',
    manualEntry: '✏️ Andika Aderesi',
    pickFromSearch: '🔍 Hitamo mu Gushakisha',
    deleteFav: 'Siba',
    savePlace: 'Bika',
    searchPlaceholder: 'Shakisha aderesi...',
    savedOk: 'Byabitswe!',
    deleteOk: 'Byasibwe.',
    noAddress: 'Nta deresi ishyizweho',
    manualAddressHint: 'Andika aderesi nawe ubwawe:',
    // TOS content
    tos_title: 'Amategeko y\'Ikoranabuhanga & Politiki y\'Ubuzima bw\'Amakuru',
    tos_agree: '✓ NEMERA — KOMEZA',
    tos_readPrivacy: 'Soma Politiki yose y\'Ubuzima bw\'Amakuru',
    tos_s1_title: '1. Kwakira Amategeko',
    tos_s1_body: 'Mu gukoresha MotoLink, wemera aya mategeko. MotoLink ni ikoranabuhanga ryunganira abagenzi n\'abashofer ba moto i Rwanda. Ntidukora nka sosiyete y\'ubwikorezi.',
    tos_s2_title: '2. Inshingano z\'Abakoresha',
    tos_s2_body: 'Ugomba kuba ufite nibura imyaka 16 gukoresha MotoLink. Uri inshingano z\'ibikorwa byose munsi ya konti yawe. Wemera kutakoresha ireli ngo ufate ibikorwa bitemewe n\'amategeko.',
    tos_s3_title: '3. Ubwishyu',
    tos_s3_body: 'Ibiciro bibarwa hakuye ku ntera. MotoLink iaka igice cya 10% ku nyemezabwishyu z\'abashofer. Ubwishyu bwose bukorwa binyuze kuri MTN MoMo, Airtel Money, cyangwa amafaranga y\'ntanganwa.',
    tos_s4_title: '4. Umutekano',
    tos_s4_body: 'MotoLink itanga serivisi ya SOS mu bihe by\'ingorane. Abashofer bagomba kugira uruhushya rw\'ubushoferi bw\'ikaze. Abagenzi barumvikana kwambara kasuku zihabwa n\'abashofer.',
    tos_s5_title: '5. Ubuzima bw\'Amakuru',
    tos_s5_body: 'Dukusanya amazina yawe, numero ya telefone, n\'amakuru y\'aho uri kugira ngo dutange serivisi zacu. Aho uri bigaragazwa gusa n\'umushoferi wawe mu gihe cy\'urugendo rugenda. Ntidushyira amakuru yawe ku nkoko ya gatatu. Amakuru abitswa neza kuri Supabase hakurikijwe amabwiriza y\'igenamiterere i Rwanda.',
    tos_s6_title: '6. Guhagarika Urugendo',
    tos_s6_body: 'Abagenzi bashobora guhagarika urugendo mbere y\'uko umushoferi awemera ku buntu. Guhagarika kenshi bishobora gutuma konti igarukanywa.',
    tos_s7_title: '7. Twandikire',
    tos_s7_body: 'Ubufasha: WhatsApp +250 788 000 000 cyangwa imeli support@motolink.rw',
    // Privacy policy content
    privacy_title: 'Politiki y\'Ubuzima bw\'Amakuru',
    privacy_updated: 'Ivuguruwe: Kamena 2025',
    privacy_s1_title: 'Amakuru Dukusanya',
    privacy_s1_body: '• Amazina yombi na numero ya telefone\n• Aho uri kuri GPS (mu bihe by\'ikoreshwa gusa)\n• Amateka y\'inzira (ahafashwe, intego, igiciro)\n• Amakuru y\'icyuma (verisiyo ya OS, verisiyo ya porogaramu)\n• Uburyo bw\'ubwishyu (ntidushyira PIN ya MoMo cyangwa Airtel)',
    privacy_s2_title: 'Ukoresha kw\'Amakuru',
    privacy_s2_body: '• Guhuza abagenzi n\'abashofer bo hafi\n• Kubara ibiciro hakuye ku ntera ya GPS\n• Gutunganya ubwishyu bwa MoMo na Airtel Money binyuze kuri USSD\n• Kohereza itangazo ry\'urugendo\n• Kunoza imikorere no guteza imbere umutekano',
    privacy_s3_title: 'Gusangira Amakuru',
    privacy_s3_body: 'Amazina yawe na numero bishyirwa umushoferi wawe gusa mu gihe cy\'urugendo. Ntidushyira amakuru ku nkoko.',
    privacy_s4_title: 'Uburenganzira Bwawe',
    privacy_s4_body: 'Ushobora gusaba gusibwa kwa konti yawe n\'amakuru yose binyuze kuri Igenamiterere → Siba Konti.',
    privacy_s5_title: 'Twandikire',
    privacy_s5_body: 'privacy@motolink.rw',
    termsOfService: 'Amategeko y\'Ikoranabuhanga',
    privacyPolicy: 'Politiki y\'Ubuzima bw\'Amakuru',
    deleteAccWarning: 'Ibi bizasiba konti yawe itasubira, amateka yose y\'inzira, no gukuraho amakuru yawe kuri MotoLink.',
    deleteAccIrreversible: 'Igikorwa gito ntikiboneka gikurweho.',
    deleteAccConfirm: 'Yego, Siba Konti Yanjye',
    goBack: '← Subira Inyuma',
    acceptBtnLabel: 'EMEZA',
    findingDriver: 'Gushaka Umushoferi...',
    activeTripFound: 'Urugendo rusubijwe',
  },

  fr: {
    welcome: 'Bienvenue sur MotoLink',
    slogan: "L'avenir du transport",
    signIn: 'Se Connecter',
    signUp: "S'inscrire",
    phone: 'Numéro de téléphone',
    pass: 'Mot de passe',
    confirmPass: 'Confirmer le mot de passe',
    name: 'Nom complet',
    driver: 'Chauffeur',
    pax: 'Passager',
    newAcc: 'Nouveau? Rejoignez-nous',
    hasAcc: 'Déjà membre? Connectez-vous',
    passMatch: '✓ Mots de passe identiques',
    passMismatch: '✗ Ne correspondent pas',
    driverDash: 'TABLEAU DE BORD',
    myRequests: 'Vos Demandes',
    noRequests: 'Aucune demande active.',
    searchWhere: 'Où allez-vous? (ex: Remera, Bus Park)',
    searchHint: 'Recherchez votre destination ci-dessus.',
    scanJobs: 'Recherche de trajets...',
    availJobs: 'Trajets Disponibles',
    pending: '⏳ EN ATTENTE',
    accepted: '✅ ACCEPTÉ',
    sentAt: 'Envoyé',
    acceptedAt: 'Accepté',
    cancelledAt: 'Annulé',
    requestedAt: 'Demandé',
    from: 'De',
    to: 'À',
    payWith: 'Payer avec',
    cash: '💵 Espèces',
    momoTap: '📲 MoMo',
    walletPay: '💳 Portefeuille',
    choosePayment: 'Choisir le mode de paiement',
    paymentInfo: 'Infos de paiement du chauffeur',
    payMerchant: 'Payer via Code Marchand',
    payMomo: 'Payer via Numéro MoMo',
    tapToPay: 'Appuyer pour payer',
    paidBtn: "J'ai payé ✓",
    confirmReceived: 'Confirmer la réception du paiement',
    paymentReceived: 'Paiement reçu ✓',
    paymentSetup: 'Configuration du paiement',
    momoType: 'Type de compte',
    personal: 'MoMo Personnel',
    merchant: 'Code Marchand',
    momoNumber: 'Numéro MoMo',
    merchantCode: 'Code Marchand',
    accountHolder: 'Nom du titulaire',
    savePayment: 'Enregistrer les infos',
    paymentRequired: 'Ajoutez vos infos de paiement pour recevoir des paiements.',
    noPaymentWarning: '⚠️ Configurez vos infos de paiement',
    arrivedBtn: 'Arrivé — Demander la fin du trajet',
    completionRequested: 'Le chauffeur est arrivé! Confirmez pour continuer.',
    confirmComplete: 'Confirmer la fin du trajet',
    driverConfirm: 'Confirmer la réception du paiement',
    awaitingPayment: 'En attente du paiement du passager...',
    awaitingDriverConfirm: 'En attente de confirmation du chauffeur...',
    settings: 'Profil',
    save: 'Enregistrer',
    signOut: 'Se déconnecter',
    deleteAcc: 'Supprimer le compte',
    wallet: 'Mon Portefeuille',
    topUp: 'Recharger',
    txHistory: 'Historique',
    walletHidden: 'Paiements par portefeuille bientôt disponibles.',
    rateTrip: 'Évaluer le trajet',
    skipRating: 'Passer',
    submitRating: 'Soumettre',
    loading: 'Chargement...',
    retry: 'Réessayer',
    close: 'Fermer',
    cancel: 'Annuler',
    km: 'km de distance',
    callDriver: '📞 Appeler le chauffeur',
    callPassenger: '📞 Appeler le passager',
    fareLabel: 'Tarif',
    activeJob: '🚦 Mission Active',
    pickupAt: 'Prise en charge à',
    cancelTrip: 'ANNULER',
    completeTrip: 'TERMINER',
    poor: '😞 Mauvais',
    fair: '😐 Passable',
    good: '🙂 Bien',
    great: '😊 Très bien',
    excellent: '🤩 Excellent!',
    tapStar: 'Appuyez sur une étoile',
    reviewPlaceholder: 'Laisser un commentaire (optionnel)...',
    // SOS
    sos: 'SOS',
    sosTitle: '🚨 Urgence SOS',
    sosConfirm: 'Cela appellera immédiatement la sécurité MotoLink, enverra votre position GPS via WhatsApp et alertera votre contact d\'urgence.',
    sosSend: 'ENVOYER SOS MAINTENANT',
    sosCancel: 'Annuler — Je suis en sécurité',
    sosActivated: '🚨 SOS Activé',
    sosSent: 'L\'équipe de sécurité et votre contact d\'urgence ont été notifiés. L\'aide est en route.',
    emergencyContact: 'Contact d\'Urgence',
    emergencyName: 'Nom du contact',
    emergencyPhone: 'Téléphone du contact',
    addEmergency: 'Ajouter un contact d\'urgence',
    // Trip History
    tripHistory: 'Historique des trajets',
    noHistory: 'Aucun trajet effectué.',
    loadMore: 'Charger plus',
    receipt: 'Reçu',
    shareWhatsApp: 'Partager via WhatsApp',
    downloadPDF: 'Télécharger PDF',
    earnings: 'Revenus',
    totalEarnings: 'Revenus totaux',
    totalTrips: 'Trajets totaux',
    tripId: 'ID du trajet',
    commission: 'Commission (10%)',
    driverEarnings: 'Revenus chauffeur',
    ratingGiven: 'Note donnée',
    notRated: 'Non évalué',
    viewReceipt: 'Voir le reçu',
    // Surge
    surgeActive: '⚡ Tarif majoré actif',
    surgeReason: 'Forte demande ou heures de pointe',
    surge1_5x: 'Tarif 1.5× appliqué',
    surgeWarning: '⚡ Tarif majoré actif (1.5×). Le tarif est plus élevé que d\'habitude en raison de la forte demande.',
    // Earnings dashboard
    earningsDash: 'Tableau des revenus',
    today: 'Aujourd\'hui',
    thisWeek: 'Cette semaine',
    thisMonth: 'Ce mois',
    allTime: 'Tout le temps',
    tripsCompleted: 'Trajets terminés',
    avgPerTrip: 'Moy. par trajet',
    peakDay: 'Meilleur jour',
    noEarnings: 'Aucun trajet terminé.',
    // Promo & Referral
    promoCode: 'Code Promo',
    applyCode: 'Appliquer',
    promoApplied: '🎉 Promo Appliquée!',
    promoInvalid: 'Code invalide ou expiré.',
    promoUsed: 'Vous avez déjà utilisé ce code.',
    promoSaved: 'économisé sur ce trajet',
    referralCode: 'Votre Code de Parrainage',
    referralShare: 'Partager & Gagner',
    referralInfo: 'Partagez votre code. Gagnez 200 FRW pour chaque chauffeur qui s\'inscrit.',
    referralEarned: 'Gains de Parrainage',
    enterRefCode: 'Avez-vous un code de parrainage? (optionnel)',
    scheduleRide: 'Planifier un trajet',
    scheduledFor: 'Prévu pour',
    scheduleDate: 'Choisir date et heure',
    upcomingRides: 'Trajets à venir',
    scheduleNow: 'Réserver maintenant',
    scheduleLater: 'Planifier pour plus tard',
    inMinutes: 'dans',
    scheduledTrip: '📅 Trajet planifié',
    preAccept: 'Pré-accepter ce trajet',
    preAccepted: '✋ Pré-accepté',
    preAcceptedBy: 'Réservé par',
    preAcceptCancel: 'Annuler la pré-acceptation',
    scheduledReminder: '⏰ Rappel de trajet planifié',
    scheduledReminderBody: 'Votre trajet planifié commence dans',
    scheduledReminderDriver: 'Votre trajet pré-accepté commence dans',
    tripStartBoth: 'Trajet bientôt',
    paymentPopup: '💳 Paiement requis',
    paymentAmount: 'Montant à payer',
    payViaCash: '💵 Payer en espèces',
    payViaMoMo: '📲 Payer via MoMo',
    paymentDone: '✅ Paiement confirmé',
    driverWaiting: 'Le chauffeur attend la confirmation du paiement',
    passengerPaid: 'Le passager a payé',
    tripCompleteSuccess: '🎉 Trajet terminé!',
    tripCompleteBody: 'Merci d\'utiliser MotoLink.',
    requestSent: '🛵 Demande envoyée!',
    requestSentBody: 'Recherche d\'un chauffeur à proximité...',
    nearbyRequest: '📍 Nouvelle demande à proximité',
    goBack: 'Retour',
    minimize: 'Réduire',
    addStop: '+ Ajouter un arrêt',
    removeStop: 'Supprimer',
    stop: 'Arrêt',
    stops: 'Arrêts',
    markReached: 'Marquer comme atteint ✓',
    nextStop: 'Prochain arrêt',
    allStopsReached: 'Tous les arrêts atteints!',
    deliveryMode: 'Livraison de colis',
    rideMode: 'Trajet',
    packageDesc: 'Description du colis',
    recipientName: 'Nom du destinataire',
    recipientPhone: 'Téléphone du destinataire',
    pickedUp: 'Marquer comme récupéré 📦',
    delivered: 'Marquer comme livré ✓',
    takePhoto: 'Prendre photo de livraison',
    deliveryStatus: 'Statut de livraison',
    pending_del: '⏳ En attente',
    pickedUp_del: '📦 Récupéré',
    delivered_del: '✅ Livré',
    business: 'Compte Entreprise',
    joinCompany: 'Rejoindre une entreprise',
    companyCode: 'Code entreprise',
    companyName: 'Nom de l\'entreprise',
    rdbNumber: 'Numéro RDB',
    billingInvoice: 'Facture mensuelle',
    billingWallet: 'Portefeuille entreprise',
    employeeRides: 'Trajets employés',
    monthlySpend: 'Dépenses mensuelles',
    leaderboard: '🏆 Classement hebdomadaire',
    topDrivers: 'Meilleurs chauffeurs cette semaine',
    yourRank: 'Votre classement',
    offlineMode: '📡 Mode hors ligne',
    offlineMsg: 'Pas de connexion. Utilisation des données en cache.',
    queuedRequest: 'Demande mise en file — sera envoyée dès la reconnexion.',
    // ── In-app notification strings ──
    notif_wrongCreds: 'Numéro ou mot de passe incorrect. Veuillez réessayer.',
    notif_noPhone: 'Veuillez saisir votre numéro de téléphone.',
    notif_noPass: 'Veuillez saisir votre mot de passe.',
    notif_noName: 'Veuillez saisir votre nom complet.',
    notif_passMismatch2: 'Les mots de passe ne correspondent pas.',
    notif_passShort: 'Le mot de passe doit contenir au moins 6 caractères.',
    notif_phoneExists: 'Ce numéro est déjà enregistré. Connectez-vous.',
    notif_allFields: 'Veuillez remplir tous les champs requis.',
    notif_noInternet: 'Pas de connexion internet. Vérifiez votre réseau.',
    notif_backOnline: 'Reconnecté! Vos demandes en attente ont été envoyées.',
    notif_locDenied: 'Localisation refusée. Activez-la dans les Paramètres.',
    notif_locOff: 'Services de localisation désactivés. Activez le GPS.',
    notif_locGranted: '📍 Position trouvée. Bienvenue sur MotoLink!',
    notif_mapPin: '📌 Destination épinglée sur la carte. Appui long pour changer.',
    notif_searchFail: 'Lieu introuvable. Essayez un autre terme.',
    notif_noGPS: 'En attente de votre position GPS...',
    notif_profileSaved: 'Profil enregistré avec succès.',
    notif_paySetupDone: 'Infos de paiement enregistrées! Vous pouvez accepter des trajets.',
    notif_promoInvalid: 'Code promo invalide ou expiré.',
    notif_promoUsed: 'Vous avez déjà utilisé ce code promo.',
    notif_promoOk: 'Code promo appliqué! Réduction ajoutée.',
    notif_scheduleNoTime: 'Veuillez choisir une date et heure pour votre trajet.',
    notif_schedulePast: 'Veuillez choisir une heure future.',
    notif_rideQueued: 'Hors connexion — trajet mis en file d\'attente.',
    notif_signupOk: 'Bienvenue sur MotoLink! Votre compte est prêt.',
    notif_signoutOk: 'Déconnecté. À bientôt!',
    notif_deleteOk: 'Compte supprimé.',
    notif_sosTitle: '🚨 SOS Envoyé',
    notif_sosSent: 'Équipe de sécurité notifiée. L\'aide est en route.',
    notif_cameraOff: 'Accès caméra refusé. Activez-le dans les Paramètres.',
    // Airtel Money
    airtelMoney: 'Airtel Money',
    airtelNumber: 'Numéro Airtel Money',
    payViaAirtel: '📲 Payer via Airtel Money',
    passengerPaySource: 'Votre compte de paiement',
    payWithMTN: '📲 MTN MoMo',
    payWithAirtel: '📲 Airtel Money',
    driverAirtelNum: 'Numéro Airtel du chauffeur',
    noDriverPayment: 'Le chauffeur n\'a pas configuré de compte de paiement.',
    ussdInstructions: 'Composez ce code USSD pour payer, puis appuyez sur Confirmer ci-dessous.',
    driverReceives: 'Le chauffeur reçoit via',
    // Favorites management
    savedPlaces: '⭐ Lieux Enregistrés',
    home: 'Domicile',
    work: 'Travail',
    fav1: 'Favori 1',
    fav2: 'Favori 2',
    manualEntry: '✏️ Saisir l\'adresse',
    pickFromSearch: '🔍 Choisir via recherche',
    deleteFav: 'Supprimer',
    savePlace: 'Enregistrer',
    searchPlaceholder: 'Rechercher une adresse...',
    savedOk: 'Enregistré!',
    deleteOk: 'Supprimé.',
    noAddress: 'Aucune adresse définie',
    manualAddressHint: 'Saisir l\'adresse manuellement:',
    // TOS content
    tos_title: 'Conditions d\'Utilisation & Politique de Confidentialité',
    tos_agree: '✓ J\'ACCEPTE — CONTINUER',
    tos_readPrivacy: 'Lire la Politique de Confidentialité complète',
    tos_s1_title: '1. Acceptation des Conditions',
    tos_s1_body: 'En utilisant MotoLink, vous acceptez ces Conditions d\'Utilisation. MotoLink est une plateforme technologique qui met en relation des passagers avec des chauffeurs de moto-taxi au Rwanda. Nous ne sommes pas une société de transport.',
    tos_s2_title: '2. Responsabilités de l\'Utilisateur',
    tos_s2_body: 'Vous devez avoir au moins 16 ans pour utiliser MotoLink. Vous êtes responsable de toute activité sous votre compte. Vous acceptez de ne pas utiliser la plateforme à des fins illégales.',
    tos_s3_title: '3. Paiements',
    tos_s3_body: 'Les tarifs sont calculés en fonction de la distance. MotoLink prélève une commission de 10% sur les gains des chauffeurs. Tous les paiements sont traités via MTN MoMo, Airtel Money ou en espèces selon l\'accord.',
    tos_s4_title: '4. Sécurité',
    tos_s4_body: 'MotoLink propose une fonction SOS pour les urgences. Les chauffeurs doivent avoir un permis de conduire valide. Les passagers sont responsables du port du casque fourni par les chauffeurs.',
    tos_s5_title: '5. Confidentialité',
    tos_s5_body: 'Nous collectons votre nom, numéro de téléphone et données de localisation pour fournir nos services. Votre position n\'est partagée qu\'avec votre chauffeur assigné pendant un trajet actif. Nous ne vendons jamais vos données personnelles. Les données sont stockées sur les serveurs Supabase conformément aux directives rwandaises de protection des données.',
    tos_s6_title: '6. Annulations',
    tos_s6_body: 'Les passagers peuvent annuler gratuitement avant qu\'un chauffeur accepte. Les annulations répétées après acceptation peuvent entraîner des restrictions de compte.',
    tos_s7_title: '7. Contact',
    tos_s7_body: 'Assistance: WhatsApp +250 788 000 000 ou email support@motolink.rw',
    // Privacy policy content
    privacy_title: 'Politique de Confidentialité',
    privacy_updated: 'Dernière mise à jour: Juin 2025',
    privacy_s1_title: 'Données que Nous Collectons',
    privacy_s1_body: '• Nom complet et numéro de téléphone (requis pour le compte)\n• Localisation GPS (pendant les sessions actives uniquement)\n• Historique des trajets (départ, destination, tarif, horodatages)\n• Informations sur l\'appareil (version OS, version app)\n• Sélection du mode de paiement (nous ne stockons jamais le PIN MoMo ou Airtel)',
    privacy_s2_title: 'Comment Nous Utilisons Vos Données',
    privacy_s2_body: '• Mise en relation des passagers avec les chauffeurs à proximité\n• Calcul des tarifs selon la distance GPS\n• Traitement des paiements MoMo et Airtel Money via USSD\n• Envoi de notifications de trajet\n• Amélioration des performances et de la sécurité',
    privacy_s3_title: 'Partage des Données',
    privacy_s3_body: 'Votre nom et téléphone sont partagés uniquement avec votre chauffeur assigné pendant les trajets. Nous ne vendons jamais de données.',
    privacy_s4_title: 'Vos Droits',
    privacy_s4_body: 'Vous pouvez demander la suppression de votre compte et de toutes les données associées à tout moment via Paramètres → Supprimer le Compte.',
    privacy_s5_title: 'Contact',
    privacy_s5_body: 'privacy@motolink.rw',
    termsOfService: 'Conditions d\'Utilisation',
    privacyPolicy: 'Politique de Confidentialité',
    deleteAccWarning: 'Ceci supprimera définitivement votre compte, tout l\'historique de trajets et supprimera vos données de MotoLink.',
    deleteAccIrreversible: 'Cette action est irréversible.',
    deleteAccConfirm: 'Oui, Supprimer Mon Compte',
    goBack: '← Retour',
    acceptBtnLabel: 'ACCEPTER',
    findingDriver: 'Recherche de chauffeur...',
    activeTripFound: 'Trajet actif restauré',
  },
};

const AppContext = createContext();

// ══════════════════════════════════════════════
// 4. UTILITIES
// ══════════════════════════════════════════════
const getDistance = (la1, lo1, la2, lo2) => {
  if (!la1||!lo1||!la2||!lo2) return '0.0';
  const R = 6371,
  dL = ((la2-la1)*Math.PI)/180,
  dN = ((lo2-lo1)*Math.PI)/180;
  const a = Math.sin(dL/2)**2+Math.cos((la1*Math.PI)/180)*Math.cos((la2*Math.PI)/180)*Math.sin(dN/2)**2;
  return (R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(2);
};
const calcFare = (d) => {
  const n = parseFloat(d);
  if (isNaN(n) || n <= 0) return 0;
  // Rwanda moto-taxi pricing tiers (FRW):
  // 0-1km: 500, 1-2km: 700, 2-5km: 700 + 200/km, 5-10km: 700 + 150/km, 10km+: 700 + 120/km
  if (n <= 1) return 500;
  if (n <= 2) return 700;
  if (n <= 5) return Math.round(700 + (n - 2) * 200);
  if (n <= 10) return Math.round(700 + 3 * 200 + (n - 5) * 150);
  return Math.round(700 + 3 * 200 + 5 * 150 + (n - 10) * 120);
};
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=> {
  const r = (Math.random()*16)|0; return (c === 'x'?r: (r&0x3)|0x8).toString(16);
});
const fmtTime = (iso) => {
  if (!iso) return ''; return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit'
  });
};
const fmtDateTime = (iso) => {
  if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString([], {
    day: '2-digit', month: 'short'
  })+' · '+d.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit'
  });
};
const fmtFRW = (n) => `${(n || 0).toLocaleString()} FRW`;

// reverseGeocode — defined below in search engine section (Photon + Nominatim fallback)

const StarRow = ({
  rating, size = 16
}) => (
  <View style={ { flexDirection: 'row', alignItems: 'center' }}>
    {[1, 2, 3, 4, 5].map(i => <Text key={i} style={ { fontSize: size, color: i <= Math.round(rating)?C.gold: C.grayDark }}>★</Text>)}
  </View>
);

// ══════════════════════════════════════════════
// 5. SESSION PERSISTENCE
// ══════════════════════════════════════════════
const ACTIVE_TRIP_KEY = '@motolink_active_trip';

const saveSession = async (session, profile, role, lang) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      session, profile, role, lang
    }));
  } catch {}
};
const saveActiveTrip = async (trip) => {
  try {
    if (trip) await AsyncStorage.setItem(ACTIVE_TRIP_KEY, JSON.stringify(trip));
    else await AsyncStorage.removeItem(ACTIVE_TRIP_KEY);
  } catch {}
};
const loadActiveTrip = async () => {
  try {
    const r = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
    return r ? JSON.parse(r) : null;
  } catch { return null; }
};

const saveFavorites = async (favs) => {
  try { await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favs)); } catch {}
};
const loadFavorites = async () => {
  try {
    const r = await AsyncStorage.getItem(FAVORITES_KEY);
    return r ? JSON.parse(r) : [];
  } catch { return []; }
};
const loadSession = async () => {
  try {
    const r = await AsyncStorage.getItem(STORAGE_KEY); return r?JSON.parse(r): null;
  } catch {
    return null;
  }
};
const clearSession = async () => {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
};

// ══════════════════════════════════════════════
// 6. PUSH NOTIFICATIONS
// ══════════════════════════════════════════════
const registerForPush = async () => {
  // Remote push notifications removed from Expo Go in SDK 53+.
  // Use a development build (eas build --profile development) to test push.
  if (IS_EXPO_GO) {
    console.log('[MotoLink] Push notifications skipped in Expo Go. Use a dev build.');
    return null;
  }
  try {
    const {
      status: e
    } = await Notifications.getPermissionsAsync();
    let s = e;
    if (e !== 'granted') {
      const {
        status
      } = await Notifications.requestPermissionsAsync(); s = status;
    }
    if (s !== 'granted') return null;
    return (await Notifications.getExpoPushTokenAsync()).data;
  } catch {
    return null;
  }
};
const sendExpoPush = async (token, title, body, data = {}) => {
  if (!token) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Accept': 'application/json'
      },
      body: JSON.stringify({
        to: token, title, body, data, sound: 'default', priority: 'high', channelId: 'motolink-default', color: '#D4AF37'
      }),
    });
  } catch {}
};
const getPushToken = async (userId) => {
  if (!userId) return null;
  const {
    data
  } = await supabase.from('profiles').select('push_token').eq('id', userId).single();
  return data?.push_token || null;
};

// ══════════════════════════════════════════════
// 7. USSD PAYMENT BUILDER
// ══════════════════════════════════════════════
// buildUSSD — handles all 4 passenger-source × driver-target USSD combinations
// passengerSource: 'mtn' | 'airtel'
// driverProfile: { momo_type, momo_number, momo_merchant_code, airtel_number }
//
// Rwanda USSD reference (per DukaFlow/MotoLink interoperable-MoMo spec):
//   MTN    → MTN personal   : *182*1*1*{phone}*{amt}#
//   MTN    → MTN merchant   : *182*8*1*{code}*{amt}#
//   MTN    → Airtel         : *182*1*2*{phone}*{amt}#   (cross-network)
//   Airtel → Airtel         : *182*1*1*{phone}*{amt}#   (same-network, via interop hub)
//   Airtel → MTN            : *182*1*2*{phone}*{amt}#   (cross-network)
const buildUSSD = (passengerSource, driverProfile, amount) => {
  const amt = Math.round(amount);
  const { momo_type, momo_number, momo_merchant_code, airtel_number } = driverProfile || {};

  if (passengerSource === 'mtn') {
    // Passenger dials from MTN SIM
    if (momo_type === 'merchant' && momo_merchant_code)
      return `tel:*182*8*1*${momo_merchant_code}*${amt}%23`;
    if (airtel_number && (!momo_number || momo_type === 'airtel'))
      return `tel:*182*1*2*${airtel_number}*${amt}%23`;
    if (momo_number)
      return `tel:*182*1*1*${momo_number}*${amt}%23`;
    if (airtel_number)
      return `tel:*182*1*2*${airtel_number}*${amt}%23`;
  }

  if (passengerSource === 'airtel') {
    // Passenger dials from Airtel SIM
    if (airtel_number)
      // Airtel → Airtel: *182*1*1*{phone}*{amount}#
      return `tel:*182*1*1*${airtel_number}*${amt}%23`;
    if (momo_type === 'merchant' && momo_merchant_code)
      // Airtel → MTN Merchant cross-network
      return `tel:*182*1*2*${momo_merchant_code}*${amt}%23`;
    if (momo_number)
      // Airtel → MTN Personal cross-network
      return `tel:*182*1*2*${momo_number}*${amt}%23`;
  }

  // Absolute fallback — show MTN if number exists, else prompt setup
  if (momo_number) return `tel:*182*1*1*${momo_number}*${amt}%23`;
  return null; // signals "no payment account"
};

// Display-friendly USSD string (not tel: URI)
const buildUSSDDisplay = (passengerSource, driverProfile, amount) => {
  const amt = Math.round(amount);
  const { momo_type, momo_number, momo_merchant_code, airtel_number } = driverProfile || {};

  if (passengerSource === 'mtn') {
    if (momo_type === 'merchant' && momo_merchant_code) return `*182*8*1*${momo_merchant_code}*${amt}#`;
    if (airtel_number && (!momo_number || momo_type === 'airtel')) return `*182*1*2*${airtel_number}*${amt}#`;
    if (momo_number) return `*182*1*1*${momo_number}*${amt}#`;
    if (airtel_number) return `*182*1*2*${airtel_number}*${amt}#`;
  }

  if (passengerSource === 'airtel') {
    // Airtel → Airtel same-network code
    if (airtel_number) return `*182*1*1*${airtel_number}*${amt}#`;
    if (momo_type === 'merchant' && momo_merchant_code) return `*182*1*2*${momo_merchant_code}*${amt}#`;
    if (momo_number) return `*182*1*2*${momo_number}*${amt}#`;
  }

  if (momo_number) return `*182*1*1*${momo_number}*${amt}#`;
  return null; // no payment configured
};

// ══════════════════════════════════════════════
// 8. SMART SEARCH ENGINE — Google Places API
//    Primary: Google Places Autocomplete + Geocoding
//    Fallback: Gemini AI coordinate inference
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// 8. SMART SEARCH ENGINE
//    Photon API (OpenStreetMap-based, no key, no CORS)
//    + Geoapify fallback (free key, works in browser)
//    + AI-powered label cleanup
//    All calls run directly in React Native — no WebView bridge needed
// ══════════════════════════════════════════════

const GOOGLE_API_KEY = 'AIzaSyAfPhXRmJr26ydMPZGWWmNG7TsKPpLDmUY';
const GEMINI_API_KEY = 'AIzaSyAfPhXRmJr26ydMPZGWWmNG7TsKPpLDmUY';
const searchCache = {};

// ── Photon geocoder — OpenStreetMap data, truly free, no CORS ──
const photonSearch = async (query, lat = -1.9441, lng = 30.0619) => {
  try {
    // layer=house,street,district,city gives house-number level results
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${lat}&lon=${lng}&limit=8&lang=en&bbox=28.8,-2.9,31.2,-0.9&layer=house&layer=street&layer=district&layer=city&layer=locality`;
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.features || []).map((f, i) => {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates || [];
      const name = p.name || (p.housenumber ? `${p.street} ${p.housenumber}`: p.street) || p.city || query;
      const district = [p.district, p.city, p.county, p.state].filter(Boolean).slice(0, 2).join(', ');
      const full = [
        p.name,
        p.street && p.housenumber ? `${p.street} ${p.housenumber}`: p.street,
        p.district, p.city, p.country
      ].filter(Boolean).join(', ');
      return {
        place_id: `photon_${i}_${coords[1]}_${coords[0]}`,
        display_name: full || name,
        description: full || name,
        structured: {
          main_text: name, secondary_text: district
        },
        lat: String(coords[1]),
        lon: String(coords[0]),
        _source: 'photon',
        _type: p.type || '',
        _osm_id: p.osm_id,
      };
    }).filter(f => f.lat && f.lon && parseFloat(f.lat) !== 0);
  } catch {
    return [];
  }
};

// ── Geoapify — free tier, 3000 req/day, proper Rwanda geocoding ──
const geoapifySearch = async (query, lat = -1.9441, lng = 30.0619) => {
  try {
    const GKEY = 'c3b7bd7fa3454aa9bff1d14d3b57f0a5';
    // type=amenity,building,street,suburb,city covers everything from house to district
    const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&filter=countrycode:rw&bias=proximity:${lng},${lat}&limit=6&lang=en&type=amenity,building,street,suburb,city&apiKey=${GKEY}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.features || []).map((f, i) => {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates || [];
      // Build a human name: prefer address_line1 (e.g. "KN 5 Rd 12") over generic name
      const name = p.address_line1 || p.name || p.street || query;
      const sub = p.address_line2 || [p.district, p.city].filter(Boolean).join(', ');
      return {
        place_id: `geo_${i}_${coords[1]}_${coords[0]}`,
        display_name: p.formatted || name,
        description: p.formatted || name,
        structured: {
          main_text: name, secondary_text: sub
        },
        lat: String(coords[1]),
        lon: String(coords[0]),
        _source: 'geoapify',
      };
    }).filter(f => f.lat && f.lon && parseFloat(f.lat) !== 0);
  } catch {
    return [];
  }
};

// ── Nominatim — OSM official, good for exact addresses ──
const nominatimSearch = async (query, lat = -1.9441, lng = 30.0619) => {
  try {
    const vb = `${lng - 0.5},${lat - 0.5},${lng + 0.5},${lat + 0.5}`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' Rwanda')}&viewbox=${vb}&bounded=0&countrycodes=rw&addressdetails=1&limit=5&dedupe=1`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'MotoLink/3.0 (motolink.rw)', 'Accept-Language': 'en'
      }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data || []).map((item, i) => {
      const a = item.address || {};
      const name = a.road || a.neighbourhood || a.suburb || a.city_district || item.display_name.split(',')[0];
      const sub = [a.suburb, a.city_district, a.city || a.town].filter(Boolean).slice(0, 2).join(', ');
      return {
        place_id: item.place_id ? `nom_${item.place_id}`: `nom_${i}`,
        display_name: item.display_name,
        description: item.display_name,
        structured: {
          main_text: name, secondary_text: sub
        },
        lat: item.lat,
        lon: item.lon,
        _source: 'nominatim',
      };
    }).filter(f => f.lat && f.lon);
  } catch {
    return [];
  }
};

// ── Reverse geocode — Photon + Nominatim in parallel, best result wins ──
const reverseGeocode = async (lat, lng) => {
  // Helper: build a human name from Photon feature
  const fromPhoton = (f) => {
    if (!f) return null;
    const p = f.properties || {};
    const parts = [
      p.name,
      p.street && p.housenumber ? `${p.street} ${p.housenumber}` : p.street,
      p.district || p.neighbourhood,
      p.city || p.town || p.village,
    ].filter(Boolean);
    const result = parts.slice(0, 2).join(', ');
    // Reject if it's just a bare city name with nothing more specific
    return result && parts.length >= 1 ? result : null;
  };

  // Helper: build a human name from Nominatim data
  const fromNominatim = (data2) => {
    if (!data2) return null;
    const a = data2.address || {};
    // Build richest available name: venue/amenity first, then road, then suburb
    const parts2 = [
      a.amenity || a.shop || a.office || a.building,
      a.road || a.pedestrian || a.path,
      a.neighbourhood || a.suburb || a.quarter,
      a.city_district || a.town || a.city,
    ].filter(Boolean);
    if (parts2.length >= 1) return parts2.slice(0, 2).join(', ');
    // Final fallback: first 2 segments of display_name
    return data2.display_name?.split(',').slice(0, 2).join(', ').trim() || null;
  };

  try {
    // Fire both in parallel with a 4-second timeout each
    const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
    const [photonRes, nominatimRes] = await Promise.allSettled([
      Promise.race([
        fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en`)
          .then(r => r.ok ? r.json() : null),
        timeout(4000),
      ]),
      Promise.race([
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
          headers: { 'User-Agent': 'MotoLink/3.0' }
        }).then(r => r.ok ? r.json() : null),
        timeout(4000),
      ]),
    ]);

    const photonName = photonRes.status === 'fulfilled'
      ? fromPhoton(photonRes.value?.features?.[0]) : null;
    const nominatimName = nominatimRes.status === 'fulfilled'
      ? fromNominatim(nominatimRes.value) : null;

    // Prefer the result with more specific info (longer, more commas = more segments)
    const best = [photonName, nominatimName]
      .filter(Boolean)
      .sort((a, b) => (b.split(',').length - a.split(',').length) || (b.length - a.length))[0];

    return best || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
};

// ── Main smartSearch — 3-source pipeline, deduplicated, proximity-sorted ──
const smartSearch = async (query, currentLat = null, currentLng = null) => {
  const q = query.trim();
  if (q.length < 2) return [];
  const ck = q.toLowerCase();
  if (searchCache[ck]) return searchCache[ck];

  const lat = currentLat || -1.9441;
  const lng = currentLng || 30.0619;

  try {
    // Fire Photon + Geoapify in parallel (both CORS-free)
    const [photon,
      geo] = await Promise.all([
        photonSearch(q, lat, lng),
        geoapifySearch(q, lat, lng),
      ]);

    // Merge, deduplicate by proximity (< 50m apart = same place)
    const all = [...photon];
    const seen = new Set(photon.map(p => `${parseFloat(p.lat).toFixed(3)},${parseFloat(p.lon).toFixed(3)}`));
    geo.forEach(g => {
      const key = `${parseFloat(g.lat).toFixed(3)},${parseFloat(g.lon).toFixed(3)}`;
      if (!seen.has(key)) {
        seen.add(key); all.push(g);
      }
    });

    // If still < 3 results, try Nominatim
    if (all.length < 3) {
      const nom = await nominatimSearch(q, lat, lng);
      nom.forEach(n => {
        const key = `${parseFloat(n.lat).toFixed(3)},${parseFloat(n.lon).toFixed(3)}`;
        if (!seen.has(key)) {
          seen.add(key); all.push(n);
        }
      });
    }

    // Sort by proximity to user
    all.sort((a, b) => {
      const da = Math.hypot(parseFloat(a.lat) - lat, parseFloat(a.lon) - lng);
      const db = Math.hypot(parseFloat(b.lat) - lat, parseFloat(b.lon) - lng);
      return da - db;
    });

    const results = all.slice(0,
      7);
    if (results.length > 0) {
      searchCache[ck] = results;
      return results;
    }

    // Last resort: return a pinnable manual entry
    const fallback = [{
      place_id: `manual_${ck}`,
      display_name: `${q}, Kigali, Rwanda`,
      description: `${q}, Kigali, Rwanda`,
      structured: {
        main_text: q,
        secondary_text: 'Long-press map to pin exact location'
      },
      lat: String(lat),
      lon: String(lng),
      _isManual: true,
      _source: 'manual',
    }];
    searchCache[ck] = fallback;
    return fallback;
  } catch {
    return [];
  }
};

// ── buildLabel — clean short display name ──
const buildLabel = (place) => {
  if (!place) return '';
  if (place.structured?.main_text) return place.structured.main_text;
  const dn = place.display_name || place.description || '';
  return dn.split(',').slice(0, 2).join(', ').trim() || dn;
};

// ══════════════════════════════════════════════
// 9. MAP ENGINE
// ══════════════════════════════════════════════
// ── Separate web-only map component so hooks are never called conditionally ──
const WebMapComponent = ({
  myLoc, targetLoc, onLongPress, onBridgeMessage, mapRef,
}) => {
  const iframeRef = useRef(null);
  const webMapReady = useRef(false);
  const webPending = useRef([]);
  const lastSentLocWeb = useRef(null);

  const haversineMWeb = (la1, ln1, la2, ln2) => {
    const R = 6371000, dLat = (la2-la1)*Math.PI/180, dLng = (ln2-ln1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  const webPost = (msg) => {
    if (webMapReady.current && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(JSON.stringify(msg), '*');
    } else {
      webPending.current.push(msg);
    }
  };

  // Expose postMessage to parent via mapRef
  useEffect(() => {
    if (mapRef) mapRef.current = {
      postMessage: webPost
    };
  },
    []);

  useEffect(() => {
    const handler = (ev) => {
      try {
        const m = typeof ev.data === 'string' ? JSON.parse(ev.data): ev.data;
        if (m.type === 'MAP_READY') {
          webMapReady.current = true;
          webPending.current.forEach(msg =>
            iframeRef.current?.contentWindow?.postMessage(JSON.stringify(msg), '*')
          );
          webPending.current = [];
          if (myLoc) webPost( {
            type: 'UPDATE_LOC', lat: myLoc.latitude, lng: myLoc.longitude, forceCenter: true
          });
          if (targetLoc && myLoc) webPost( {
            type: 'SET_TARGET', lat: targetLoc.latitude, lng: targetLoc.longitude,
            myLat: myLoc.latitude, myLng: myLoc.longitude,
          });
        }
        if (m.type === 'LONG_PRESS' && onLongPress) {
          onLongPress( {
            latitude: m.lat, longitude: m.lng, address: m.address || ''
          });
        }
        if (['SEARCH_RESULTS', 'RESOLVE_RESULT'].includes(m.type) && onBridgeMessage) {
          onBridgeMessage(m);
        }
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  },
    [onLongPress,
      onBridgeMessage]);

  useEffect(() => {
    if (!myLoc) return;
    const { latitude: la, longitude: ln } = myLoc;
    const last = lastSentLocWeb.current;
    if (!last || haversineMWeb(last.la, last.ln, la, ln) > 15) {
      lastSentLocWeb.current = { la, ln };
      webPost({ type: 'UPDATE_LOC', lat: la, lng: ln });
    }
  }, [myLoc]);

  useEffect(() => {
    if (targetLoc && myLoc) {
      webPost( {
        type: 'SET_TARGET', lat: targetLoc.latitude, lng: targetLoc.longitude, myLat: myLoc.latitude, myLng: myLoc.longitude
      });
    } else {
      webPost( {
        type: 'CLEAR_TARGET'
      });
    }
  },
    [targetLoc]);

  // ── CRITICAL: lock initial map centre to first GPS fix (or Kigali fallback).
  // Previously iLat/iLng recomputed from myLoc on every render → webMapHtml
  // changed → iframe fully reloaded, destroying all tiles and markers on every
  // GPS update (the "flashing" bug).
  const initCentreRef = useRef(null);
  if (!initCentreRef.current) {
    initCentreRef.current = {
      lat: myLoc?.latitude  || -1.9441,
      lng: myLoc?.longitude || 30.0619,
    };
  }
  const iLat = initCentreRef.current.lat;
  const iLng = initCentreRef.current.lng;

  // webMapHtml is now stable (built once from locked coords) — useMemo guards
  // against any accidental re-evaluation even if the component re-renders.
  const buildMapHtml = (iLat, iLng, isNative) => {
    const sendFn = isNative
    ? `function send(o){try{window.ReactNativeWebView.postMessage(JSON.stringify(o))}catch(e){}}`: `function send(o){try{parent.postMessage(JSON.stringify(o),'*')}catch(e){}}`;
    return `<!DOCTYPE html>
    <html>
    <head>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"/>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css" crossorigin="anonymous"/>
    <script>
    (function(){
      var srcs=[
        'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js',
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
      ];
      var idx=0;
      function tryNext(){
        if(idx>=srcs.length)return;
        var s=document.createElement('script');
        s.src=srcs[idx++];
        s.crossOrigin='anonymous';
        s.onerror=tryNext;
        document.head.appendChild(s);
      }
      tryNext();
    })();
    <\/script>
    <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body,#map{width:100%;height:100%;overflow:hidden;background:#0d0d14}
    .leaflet-control-zoom,.leaflet-control-attribution{display:none!important}
    .leaflet-container{background:#0d0d14!important}
    /* CartoDB dark_all tiles are already dark with proper place-name labels baked
       in — no CSS filter needed (a per-frame filter on the tile pane was a likely
       cause of the flashing/jank during pan & tile load). */
    @keyframes ring{0%{transform:scale(1);opacity:.9}60%{transform:scale(2.2);opacity:.3}100%{transform:scale(2.8);opacity:0}}
    @keyframes markerPop{0%{transform:scale(0.5);opacity:0}70%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}
    .pulse{position:absolute;border:2.5px solid #D4AF37;border-radius:50%;width:28px;height:28px;top:-7px;left:-7px;animation:ring 2s ease-out infinite;pointer-events:none}
    .pulse2{position:absolute;border:1.5px solid rgba(212,175,55,.45);border-radius:50%;width:44px;height:44px;top:-15px;left:-15px;animation:ring 2s .5s ease-out infinite;pointer-events:none}
    .my-dot{background:#D4AF37;width:14px;height:14px;border-radius:50%;border:2.5px solid #111;box-shadow:0 0 16px rgba(212,175,55,1),0 0 32px rgba(212,175,55,.5);position:relative;z-index:2;animation:markerPop .4s ease}
    .lbl{background:rgba(6,6,16,.93);border:1.5px solid #D4AF37;border-radius:14px;padding:10px 14px;color:#fff;font-family:system-ui,-apple-system,sans-serif;max-width:260px;backdrop-filter:blur(8px)}
    .lbl b{color:#D4AF37;font-size:13px;display:block;margin-bottom:3px;font-weight:800}
    .lbl small{color:#9A9AB0;font-size:10.5px;line-height:1.4}
    .leaflet-popup-content-wrapper,.leaflet-popup-tip{background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important}
    .leaflet-popup-content{margin:0!important}
    .leaflet-popup-tip-container{display:none!important}
    #loc-btn{position:absolute;bottom:88px;right:12px;z-index:9000;width:46px;height:46px;border-radius:50%;background:rgba(6,6,16,.93);border:2px solid #D4AF37;color:#D4AF37;font-size:19px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.8),0 0 12px rgba(212,175,55,.2)}
    #lp-ring{position:absolute;pointer-events:none;display:none;z-index:8000;width:64px;height:64px;border-radius:50%;border:2.5px solid #D4AF37;transform:translate(-50%,-50%);animation:ring 1s ease-out infinite}
    .leaflet-tile{will-change:transform}.leaflet-pane{will-change:transform}
    #map{opacity:0;transition:opacity .6s ease}#map.ml-ready{opacity:1}
    /* Driver icon */
    .drv-icon{font-size:20px;filter:drop-shadow(0 0 8px rgba(212,175,55,.9))}
    <\/style>
    <\/head>
    <body>
    <div id="map"><\/div>
    <div id="lp-ring"><\/div>
    <button id="loc-btn">📍<\/button>
    <script>
    (function(){
    var iLat=${iLat},iLng=${iLng};
    ${sendFn}

    var leafletWaitMs=0;
    function initMap(){
    if(typeof L==='undefined'){
    leafletWaitMs+=250;
    if(leafletWaitMs>30000){
    document.body.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:#0d0d14;color:#D4AF37;font-family:system-ui;font-size:13px;text-align:center;padding:24px;gap:16px"><div style="font-size:36px">🗺️</div><div style="font-weight:900;font-size:16px">Map unavailable</div><div style="color:#9A9AB0;font-size:12px">Check your connection</div><button onclick="location.reload()" style="margin-top:16px;background:#D4AF37;color:#080810;border:none;padding:12px 28px;border-radius:24px;font-weight:900;font-size:13px;cursor:pointer;letter-spacing:1px">RETRY</button></div>';
    send({type:'MAP_TILE_ERROR'});
    return;
    }
    setTimeout(initMap,250);return;
    }

    // Default Leaflet interaction options (no custom canvas renderer, tap-delay
    // shim, zoomSnap, or wheel-speed override) — this exact setup is what's
    // proven stable/adjustable on the live trip-tracking page; the previous
    // manual overrides here were the likely cause of panning/zooming "fighting".
    var map=L.map('map',{zoomControl:false,attributionControl:false})
      .setView([iLat,iLng],16);

    // ── TILE LAYER ───────────────────────────────────────────────────────────
    // CartoDB Dark Matter — already a dark cartographic style with real
    // street/place names baked into the tile image itself (no CSS filter or
    // separate label-chip overlay needed, and none applied — matches the
    // tracking page exactly). Served via CartoDB's CDN, which (unlike
    // tile.openstreetmap.org) doesn't enforce a strict referer policy, so it
    // loads reliably from in-app WebViews/iframes.
    var cdbDark = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {subdomains:'abcd',maxZoom:20,minZoom:2,keepBuffer:8,
    updateWhenIdle:false,updateWhenZooming:false}
    );
    // Fallback — OSM Standard, last resort only
    var osmStd = L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {maxZoom:19,minZoom:2,keepBuffer:8,updateWhenIdle:false,updateWhenZooming:false,
    tileSize:256,zoomOffset:0,attribution:'© OpenStreetMap contributors'}
    );

    cdbDark.addTo(map);

    // Tile error cascade — silent fallback
    var cdbDErr=0;
    cdbDark.on('tileerror',function(){
    cdbDErr++;
    if(cdbDErr>=4&&map.hasLayer(cdbDark)){
    map.removeLayer(cdbDark);
    osmStd.addTo(map);
    }
    });

    // ── LOCATE ME ────────────────────────────────────────────────────────────
    document.getElementById('loc-btn').addEventListener('click',function(e){
    e.stopPropagation();
    var p=myMk.getLatLng();
    if(destMk){
    try{map.fitBounds(L.featureGroup([myMk,destMk]).getBounds().pad(.28),{animate:true,maxZoom:17});}
    catch(ex){map.setView([p.lat,p.lng],16,{animate:true});}
    }else{
    map.setView([p.lat,p.lng],16,{animate:true,duration:.6});
    }
    });

    // ── MARKERS ──────────────────────────────────────────────────────────────
    var myIcon=L.divIcon({className:'',
    html:'<div style="position:relative;width:14px;height:14px"><div class="pulse"><\/div><div class="pulse2"><\/div><div class="my-dot"><\/div><\/div>',
    iconSize:[14,14],iconAnchor:[7,7]});
    var destIcon=L.divIcon({className:'',
    html:'<div style="position:relative;animation:markerPop .35s ease"><div style="background:#2ECC71;width:20px;height:20px;border-radius:50%;border:3px solid #111;box-shadow:0 0 18px rgba(46,204,113,1),0 0 36px rgba(46,204,113,.4)"><\/div><\/div>',
    iconSize:[20,20],iconAnchor:[10,10]});
    var pinIcon=L.divIcon({className:'',
    html:'<div style="text-align:center;animation:markerPop .35s ease"><div style="background:#FF4C4C;width:26px;height:26px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 18px rgba(255,76,76,1),0 0 36px rgba(255,76,76,.4);display:flex;align-items:center;justify-content:center;font-size:14px">📌<\/div><div style="width:2px;height:12px;background:linear-gradient(#FF4C4C,transparent);margin:0 auto"><\/div><\/div>',
    iconSize:[26,38],iconAnchor:[13,38]});
    var driverIcon=L.divIcon({className:'',
    html:'<div class="drv-icon" style="animation:markerPop .35s ease">🏍️<\/div>',
    iconSize:[28,28],iconAnchor:[14,20]});

    var myMk=L.marker([iLat,iLng],{icon:myIcon,zIndexOffset:1000,interactive:false}).addTo(map);
    var destMk=null,pinMk=null,rGlow=null,rLine=null,driverMk=null,ready=false;

    // ── ROUTE ─────────────────────────────────────────────────────────────────
    function clearRoute(){
    if(rGlow){try{map.removeLayer(rGlow)}catch(e){}rGlow=null}
    if(rLine){try{map.removeLayer(rLine)}catch(e){}rLine=null}
    }
    var routeReqId=0;
    function drawRoute(la1,ln1,la2,ln2){
    var reqId=++routeReqId;
    clearRoute();
    // Immediate straight-line so map is never empty
    var pts=[[la1,ln1],[la2,ln2]];
    rGlow=L.polyline(pts,{color:'rgba(212,175,55,.15)',weight:12,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
    rLine=L.polyline(pts,{color:'#D4AF37',weight:4,dashArray:'12 7',lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
    // OSRM real road route (non-blocking, with AbortController timeout)
    var ctrl=typeof AbortController!=='undefined'?new AbortController():null;
    var sig=ctrl?ctrl.signal:undefined;
    if(ctrl)setTimeout(function(){try{ctrl.abort()}catch(e){}},9000);
    fetch('https://router.project-osrm.org/route/v1/driving/'+ln1+','+la1+';'+ln2+','+la2+'?overview=full&geometries=geojson',sig?{signal:sig}:{})
    .then(function(r){return r.json()})
    .then(function(d){
    if(reqId!==routeReqId||!d.routes||!d.routes[0])return;
    var c=d.routes[0].geometry.coordinates.map(function(p){return[p[1],p[0]]});
    clearRoute();
    rGlow=L.polyline(c,{color:'rgba(212,175,55,.18)',weight:12,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
    rLine=L.polyline(c,{color:'#D4AF37',weight:4.5,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
    })
    .catch(function(){/* straight-line stays */});
    }

    // ── LONG PRESS ──────────────────────────────────────────────────────────
    var lpT=null;
    var ring=document.getElementById('lp-ring');
    function startLP(x,y){
    ring.style.left=x+'px';ring.style.top=y+'px';ring.style.display='block';
    lpT=setTimeout(function(){
    ring.style.display='none';
    var pt=map.containerPointToLatLng([x,y]);
    var la=pt.lat.toFixed(6),ln=pt.lng.toFixed(6);
    if(pinMk){map.removeLayer(pinMk);pinMk=null}
    pinMk=L.marker([pt.lat,pt.lng],{icon:pinIcon,zIndexOffset:800}).addTo(map);
    fetch('https://nominatim.openstreetmap.org/reverse?lat='+la+'&lon='+ln+'&format=json&zoom=18&addressdetails=1&accept-language=en',{headers:{'User-Agent':'MotoLink/1.0'}})
    .then(function(r){return r.json()})
    .then(function(geo){
    var a=geo.address||{};
    var short=a.road||a.neighbourhood||a.suburb||a.quarter||a.city_district||a.city||(geo.display_name||'').split(',')[0];
    var district=a.suburb||a.city_district||a.county||'';
    var popup=L.popup({closeButton:false,offset:[0,-24],autoPan:false})
    .setLatLng([pt.lat,pt.lng])
    .setContent('<div class="lbl"><b>📍 '+short+'<\/b><small>'+district+'<\/small><\/div>');
    pinMk.bindPopup(popup).openPopup();
    send({type:'LONG_PRESS',lat:pt.lat,lng:pt.lng,address:geo.display_name||la+','+ln,shortAddress:short});
    })
    .catch(function(){
    send({type:'LONG_PRESS',lat:pt.lat,lng:pt.lng,address:la+', '+ln,shortAddress:la+', '+ln});
    });
    },700);
    }
    function stopLP(){if(lpT){clearTimeout(lpT);lpT=null}ring.style.display='none'}

    var el=document.getElementById('map');
    el.addEventListener('touchstart',function(e){if(e.touches.length===1)startLP(e.touches[0].clientX,e.touches[0].clientY)},{passive:true});
    el.addEventListener('touchend',stopLP,{passive:true});
    el.addEventListener('touchmove',stopLP,{passive:true});
    el.addEventListener('touchcancel',stopLP,{passive:true});
    el.addEventListener('mousedown',function(e){if(e.button===0)startLP(e.clientX,e.clientY)});
    el.addEventListener('mouseup',stopLP);

    // ── MESSAGE HANDLER ──────────────────────────────────────────────────────
    function handle(e){
    try{
    var d=JSON.parse(typeof e.data==='string'?e.data:JSON.stringify(e.data));
    if(d.type==='UPDATE_LOC'){
    var la=+d.lat,ln=+d.lng;if(isNaN(la)||isNaN(ln))return;
    myMk.setLatLng([la,ln]);
    if(!ready){map.setView([la,ln],16,{animate:false});ready=true;}
    else if(d.forceCenter===true){map.setView([la,ln],16,{animate:true,duration:0.6});}
    if(rLine&&destMk){var tl=destMk.getLatLng();drawRoute(la,ln,tl.lat,tl.lng);}
    return;
    }
    if(d.type==='UPDATE_DRIVER_LOC'){
    var dla=+d.lat,dln=+d.lng;if(isNaN(dla)||isNaN(dln))return;
    if(!driverMk){
    driverMk=L.marker([dla,dln],{icon:driverIcon,zIndexOffset:950,interactive:false}).addTo(map);
    }else{driverMk.setLatLng([dla,dln]);}
    return;
    }
    if(d.type==='REMOVE_DRIVER'){if(driverMk){try{map.removeLayer(driverMk)}catch(e){}driverMk=null;}return;}
    if(d.type==='SET_BOTTOM_OFFSET'){return;}
    if(d.type==='SET_TARGET'){
    var tla=+d.lat,tln=+d.lng,mla=+d.myLat,mln=+d.myLng;
    if(isNaN(tla)||isNaN(tln))return;
    if(destMk){map.removeLayer(destMk);destMk=null;}
    if(pinMk){map.removeLayer(pinMk);pinMk=null;}
    clearRoute();
    destMk=L.marker([tla,tln],{icon:destIcon,zIndexOffset:900}).addTo(map);
    if(!isNaN(mla)&&!isNaN(mln)){drawRoute(mla,mln,tla,tln);}
    setTimeout(function(){
    try{map.fitBounds(L.featureGroup([myMk,destMk]).getBounds().pad(.3),{animate:true,maxZoom:17});}catch(e){}
    },250);
    return;
    }
    if(d.type==='CLEAR_TARGET'){
    if(destMk){map.removeLayer(destMk);destMk=null;}
    if(pinMk){map.removeLayer(pinMk);pinMk=null;}
    clearRoute();
    var p=myMk.getLatLng();map.setView([p.lat,p.lng],16,{animate:true,duration:.7});
    return;
    }
    }catch(err){}
    }
    document.addEventListener('message',handle);
    window.addEventListener('message',handle);

    // Signal ready
    setTimeout(function(){
    document.getElementById('map').classList.add('ml-ready');
    send({type:'MAP_READY'});
    },800);
    }
    initMap();
    })();
    <\/script>
    <\/body>
    <\/html>`;
  };

  // Build HTML once, locked to initCentreRef coords — never rebuilds on GPS update
  const webMapHtml = useMemo(() => buildMapHtml(iLat, iLng, false), []); // eslint-disable-line

  return (
    <View style={styles.map}>
      {React.createElement('iframe', {
        ref: iframeRef,
        srcDoc: webMapHtml,
        title: 'MotoLink Map',
        style: {
          width: '100%', height: '100%', border: 'none', backgroundColor: '#0d0d0d'
        },
        sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox',
        referrerPolicy: 'no-referrer-when-downgrade',
      })}
    </View>
  );
};

// ── Native MapComponent — hooks always run unconditionally at top ────────────
const MapComponent = ({
  myLoc,
  targetLoc,
  onLongPress,
  onBridgeMessage,
  mapRef,
  bottomOffset,
}) => {
  const webViewRef = useRef(null);
  const mapReady = useRef(false);
  const pending = useRef([]);
  const lastSentLoc = useRef(null); // Track last sent location to throttle updates

  // Haversine distance in metres between two lat/lng pairs
  const haversineM = (la1, ln1, la2, ln2) => {
    const R = 6371000, dLat = (la2-la1)*Math.PI/180, dLng = (ln2-ln1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  const postMsg = (msg) => {
    if (mapReady.current && webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(msg));
    } else {
      pending.current.push(msg);
    }
  };

  // Expose postMessage to parent MotoLink via mapRef
  useEffect(() => {
    if (mapRef) mapRef.current = {
      postMessage: postMsg
    };
  },
    []);

  const onReady = () => {
    mapReady.current = true;
    pending.current.forEach(m => webViewRef.current?.postMessage(JSON.stringify(m)));
    pending.current = [];
    if (myLoc) {
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'UPDATE_LOC', lat: myLoc.latitude, lng: myLoc.longitude, forceCenter: true
      }));
    }
    if (targetLoc && myLoc) {
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'SET_TARGET', lat: targetLoc.latitude, lng: targetLoc.longitude,
        myLat: myLoc.latitude, myLng: myLoc.longitude
      }));
    }
    if (bottomOffset != null) {
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'SET_BOTTOM_OFFSET', offset: bottomOffset
      }));
    }
  };

  useEffect(() => {
    if (!myLoc) return;
    const { latitude: la, longitude: ln } = myLoc;
    const last = lastSentLoc.current;
    // Always send first fix; after that only if moved >15m
    if (!last || haversineM(last.la, last.ln, la, ln) > 15) {
      lastSentLoc.current = { la, ln };
      postMsg({ type: 'UPDATE_LOC', lat: la, lng: ln });
    }
  }, [myLoc]);

  useEffect(() => {
    if (targetLoc && myLoc) postMsg( {
      type: 'SET_TARGET', lat: targetLoc.latitude, lng: targetLoc.longitude,
      myLat: myLoc.latitude, myLng: myLoc.longitude
    });
    else postMsg( {
      type: 'CLEAR_TARGET'
    });
  },
    [targetLoc]);

  // Push bottom offset changes into the WebView whenever it changes
  useEffect(() => {
    if (bottomOffset != null) postMsg( {
      type: 'SET_BOTTOM_OFFSET', offset: bottomOffset
    });
  },
    [bottomOffset]);

  // Route to web component — no hooks called after this point
  if (Platform.OS === 'web') {
    return <WebMapComponent myLoc={myLoc} targetLoc={targetLoc} onLongPress={onLongPress} onBridgeMessage={onBridgeMessage} />;
  }

  // Same fix as web path: lock to first GPS fix so html string never changes
  const nativeInitRef = useRef(null);
  if (!nativeInitRef.current) {
    nativeInitRef.current = {
      lat: myLoc?.latitude  || -1.9441,
      lng: myLoc?.longitude || 30.0619,
    };
  }
  const iLat = nativeInitRef.current.lat;
  const iLng = nativeInitRef.current.lng;
  const html = useMemo(() => buildMapHtml(iLat, iLng, true), []);


  return (
    <WebView ref={webViewRef} originWhitelist={['*']}
      source={ { html, baseUrl: 'https://motolink.app' }}
      style={styles.map}
      scrollEnabled={false} bounces={false} overScrollMode="never"
      javaScriptEnabled={true}
      domStorageEnabled={true}
      startInLoadingState={false}
      mixedContentMode="always"
      allowsInlineMediaPlayback={true}
      allowUniversalAccessFromFileURLs={true}
      allowFileAccess={true}
      allowFileAccessFromFileURLs={true}
      cacheEnabled={true}
      cacheMode="LOAD_DEFAULT"
      thirdPartyCookiesEnabled={true}
      geolocationEnabled={false}
      setSupportMultipleWindows={false}
      androidLayerType="hardware"
      androidHardwareAccelerationDisabled={false}
      overScrollMode="never"
      userAgent="Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36"
      renderLoading={() => <View style={[styles.map, { backgroundColor: C.black }]} />}
      onMessage={e => {
        try {
          const m = JSON.parse(e.nativeEvent.data);
          if (m.type === 'MAP_READY') onReady();
          if (m.type === 'LONG_PRESS' && onLongPress) {
            onLongPress( {
              latitude: m.lat, longitude: m.lng, address: m.address
            });
          }
          if (['SEARCH_RESULTS', 'RESOLVE_RESULT'].includes(m.type) && onBridgeMessage) {
            onBridgeMessage(m);
          }
        } catch {}
      }}
      onError={() => {
        mapReady.current = false;
      }}
      onHttpError={() => {
        mapReady.current = false;
      }} />
  );
};

// ══════════════════════════════════════════════
// 10. MOTOLINK IN-APP NOTIFICATION SYSTEM
//     Premium branded banners with animations,
//     progress bar, swipe-to-dismiss, all types
// ══════════════════════════════════════════════

// Notification type configuration
const NOTIF_CONFIG = {
  ride: {
    icon: '🛵',
    accent: C.gold,
    label: 'RIDE'
  },
  accepted: {
    icon: '✅',
    accent: C.green,
    label: 'ACCEPTED'
  },
  cancelled: {
    icon: '❌',
    accent: C.red,
    label: 'ALERT'
  },
  completed: {
    icon: '🎉',
    accent: C.green,
    label: 'DONE'
  },
  search: {
    icon: '🔍',
    accent: C.blue,
    label: 'INFO'
  },
  rated: {
    icon: '⭐',
    accent: C.gold,
    label: 'RATING'
  },
  payment: {
    icon: '💰',
    accent: C.blue,
    label: 'PAYMENT'
  },
  sos: {
    icon: '🚨',
    accent: C.red,
    label: 'SOS'
  },
  error: {
    icon: '⚠️',
    accent: C.red,
    label: 'ERROR'
  },
  warning: {
    icon: '⚠️',
    accent: C.orange,
    label: 'WARNING'
  },
  success: {
    icon: '✓',
    accent: C.green,
    label: 'SUCCESS'
  },
  location: {
    icon: '📍',
    accent: C.blue,
    label: 'GPS'
  },
  offline: {
    icon: '📡',
    accent: C.orange,
    label: 'OFFLINE'
  },
  online: {
    icon: '🌐',
    accent: C.green,
    label: 'ONLINE'
  },
  wallet: {
    icon: '💳',
    accent: C.gold,
    label: 'WALLET'
  },
  default: {
    icon: '🔔',
    accent: C.gold,
    label: 'MOTOLINK'
  },
  };

  const NOTIF_DURATION = 4200; // ms before auto-dismiss

  const NotificationBanner = ({
    data,
    onHide
  }) => {
    const translateY = useRef(new Animated.Value(-160)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const scale = useRef(new Animated.Value(0.92)).current;
    const progress = useRef(new Animated.Value(1)).current;
    const shimmerX = useRef(new Animated.Value(-width)).current;
    const dismissTimer = useRef(null);
    const panY = useRef(new Animated.Value(0)).current;

    // Swipe-up-to-dismiss pan responder (native only)
    const pan = useRef(Platform.OS !== 'web' ? PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        if (g.dy < 0) panY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -40 || g.vy < -0.5) {
          // Fast swipe up — dismiss
          clearTimeout(dismissTimer.current);
          Animated.parallel([
            Animated.timing(panY, {
              toValue: -200, duration: 220, useNativeDriver: true
            }),
            Animated.timing(opacity, {
              toValue: 0, duration: 220, useNativeDriver: true
            }),
          ]).start(() => onHide());
        } else {
          // Snap back
          Animated.spring(panY, {
            toValue: 0, useNativeDriver: true, friction: 8
          }).start();
        }
      },
    }): {
      panHandlers: {}
    }).current;

    useEffect(() => {
      if (!data) return;

      // Reset
      translateY.setValue(-160);
      opacity.setValue(0);
      scale.setValue(0.92);
      progress.setValue(1);
      shimmerX.setValue(-width);
      panY.setValue(0);
      clearTimeout(dismissTimer.current);

      // Entrance: spring slide-down + fade + scale
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0, useNativeDriver: true,
          friction: 9, tension: 85,
        }),
        Animated.timing(opacity, {
          toValue: 1, duration: 200, useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1, useNativeDriver: true,
          friction: 7, tension: 100,
        }),
      ]).start(() => {
        // Shimmer sweep after entrance
        Animated.timing(shimmerX, {
          toValue: width * 2, duration: 700,
          useNativeDriver: true,
          easing: Easing.out(Easing.quad),
        }).start();
      });

      // Progress bar drains over NOTIF_DURATION
      Animated.timing(progress, {
        toValue: 0,
        duration: NOTIF_DURATION,
        useNativeDriver: false,
        easing: Easing.linear,
      }).start();

      // Auto-dismiss
      dismissTimer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -160, duration: 320, useNativeDriver: true
          }),
          Animated.timing(opacity, {
            toValue: 0, duration: 320, useNativeDriver: true
          }),
          Animated.timing(scale, {
            toValue: 0.94, duration: 320, useNativeDriver: true
          }),
        ]).start(() => onHide());
      }, NOTIF_DURATION);

      return () => clearTimeout(dismissTimer.current);
    },
      [data]);

    if (!data) return null;

    const cfg = NOTIF_CONFIG[data.type] || NOTIF_CONFIG.default;
    const accent = cfg.accent;

    const progressWidth = progress.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    });

    return (
      <Animated.View
        style={[
          styles.notifyBanner,
          {
            transform: [{ translateY: Animated.add(translateY, panY) }, { scale }],
            opacity,
            borderColor: accent + '40',
            shadowColor: accent,
          },
        ]}
        {...pan.panHandlers}
        >
        {/* Tap-to-dismiss on web */}
        {Platform.OS === 'web' && (
          <TouchableOpacity
            onPress={() => { clearTimeout(dismissTimer.current); onHide(); }}
            style={ { position: 'absolute', top: 6, right: 10, zIndex: 2, padding: 4 }}
            >
            <Text style={ { color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>✕</Text>
          </TouchableOpacity>
        )}
        {/* Left accent stripe */}
        <View style={[styles.notifyAccent, { backgroundColor: accent }]} />

        {/* ML Logo mark */}
        <View style={[styles.notifyLogoWrap, { backgroundColor: accent + '20', borderColor: accent + '50' }]}>
          <Text style={[styles.notifyLogoTxt, { color: accent }]}>ML</Text>
        </View>

        {/* Content */}
        <View style={styles.notifyContent}>
          {/* Type label + title row */}
          <View style={ { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <View style={ { backgroundColor: accent + '22', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={ { color: accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 }}>{cfg.label}</Text>
            </View>
            <Text style={styles.notifyTitle} numberOfLines={1}>{data.title}</Text>
          </View>
          <Text style={styles.notifyBody} numberOfLines={2}>{data.body}</Text>
        </View>

        {/* Icon */}
        <View style={ { paddingRight: 4, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={ { fontSize: 22 }}>{cfg.icon}</Text>
        </View>

        {/* Shimmer overlay */}
        <Animated.View
          pointerEvents="none"
          style={ {
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            borderRadius: 20, overflow: 'hidden',
          }}
          >
          <Animated.View
            style={ {
              position: 'absolute', top: 0, bottom: 0, width: 80,
              transform: [{ translateX: shimmerX }],
              backgroundColor: 'rgba(255,255,255,0.07)',
              skewX: '-20deg',
            }}
            />
        </Animated.View>

        {/* Progress bar at bottom */}
        <View style={styles.notifyProgressTrack}>
          <Animated.View
            style={[
              styles.notifyProgressBar,
              { width: progressWidth, backgroundColor: accent },
            ]}
            />
        </View>

        {/* Swipe hint */}
        <View style={styles.notifyDragHandle} />
      </Animated.View>
    );
  };

  // ══════════════════════════════════════════════
  // 11. RATING MODAL
  // ══════════════════════════════════════════════
  const RatingModal = ({
    visible,
    trip,
    role,
    t,
    onSubmit,
    onSkip
  }) => {
    const [stars,
      setStars] = useState(0);
    const [review,
      setReview] = useState('');
    const sa = useRef([...Array(5)].map(()=>new Animated.Value(1))).current;
    const tap = (i)=> {
      setStars(i); Animated.sequence([Animated.timing(sa[i-1], {
        toValue: 1.45, duration: 110, useNativeDriver: true
      }), Animated.spring(sa[i-1], {
        toValue: 1, useNativeDriver: true, friction: 5
      })]).start();
    };
    const ratedPerson = role === 'passenger'?(trip?.driver_name || 'Driver'): (trip?.passenger_name || 'Passenger');
    const label = stars === 0?t.tapStar: stars === 1?t.poor: stars === 2?t.fair: stars === 3?t.good: stars === 4?t.great: t.excellent;
    return (
      <Modal visible={visible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios'?'padding': 'height'} style={ { flex: 1 }}>
          <View style={styles.modalBg}>
            <ScrollView contentContainerStyle={[styles.glassModal, { alignItems: 'center' }]} keyboardShouldPersistTaps="handled">
              <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
              <Text style={styles.rateTitle}>{t.rateTrip}</Text>
              <Text style={styles.rateSub}>{ratedPerson}</Text>
              {trip && (
                <View style={styles.rateTripSummary}>
                  <View style={styles.routeBlock}><View style={styles.routeDot} /><Text style={ { color: C.gray, fontSize: 12, flex: 1 }} numberOfLines={1}>{trip.pickup_address}</Text></View>
                  <View style={styles.routeLine_} />
                  <View style={styles.routeBlock}><View style={[styles.routeDot, { backgroundColor: C.green }]} /><Text style={ { color: C.offWhite, fontSize: 12, flex: 1 }} numberOfLines={1}>{trip.destination_address}</Text></View>
                  <Text style={ { color: C.gold, fontSize: 12, marginTop: 8 }}>{fmtFRW(trip.price)} · {fmtDateTime(trip.created_at)}</Text>
                </View>
              )}
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map(i => (
                  <TouchableOpacity key={i} onPress={()=>tap(i)} activeOpacity={0.8}>
                    <Animated.Text style={[styles.rateStar, { color: i <= stars?C.gold: C.grayDark, transform: [{ scale: sa[i-1]}]}]}>★</Animated.Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.rateLabel}>{label}</Text>
              <TextInput style={styles.reviewInput} placeholder={t.reviewPlaceholder} placeholderTextColor={C.grayDark} value={review} onChangeText={setReview} multiline maxLength={200} />
              <TouchableOpacity style={[styles.mainBtn, { width: '100%', opacity: stars === 0?0.45: 1 }]} onPress={()=> { if (stars > 0) { onSubmit(stars, review); setStars(0); setReview(''); }}} disabled={stars === 0}>
                <Text style={styles.mainBtnTxt}>⭐ {t.submitRating}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=> { setStars(0); setReview(''); onSkip(); }} style={ { marginTop: 14 }}>
                <Text style={ { color: C.gray,
                  fontSize: 13 }}>{t.skipRating}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  // ══════════════════════════════════════════════
  // 12. PAYMENT POPUP MODAL — UPGRADE: full trip info, ❌ close, proper flow
  // ══════════════════════════════════════════════
  const PaymentModal = ({
    visible,
    trip,
    driverProfile,
    t,
    onPaid,
    onCash,
    onClose,
    defaultMethod,
  }) => {
    // method: null | 'mtn' | 'airtel' | 'cash'
    const [method, setMethod] = useState(null);
    const [paid, setPaid] = useState(false);
    const pollRef = useRef(null);

    // Glassmorphic motion: fade/slide between steps + a soft breathing pulse on the CTA
    const stepAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const pulseLoopRef = useRef(null);

    useEffect(() => {
      stepAnim.setValue(0);
      Animated.spring(stepAnim, { toValue: 1, friction: 8, tension: 55, useNativeDriver: true }).start();
    }, [method, paid]);

    useEffect(() => {
      if (pulseLoopRef.current) { pulseLoopRef.current.stop(); pulseLoopRef.current = null; }
      if ((method === 'mtn' || method === 'airtel') && !paid) {
        pulseAnim.setValue(1);
        pulseLoopRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.045, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ])
        );
        pulseLoopRef.current.start();
      }
      return () => { if (pulseLoopRef.current) { pulseLoopRef.current.stop(); pulseLoopRef.current = null; } };
    }, [method, paid]);

    const stepEnterStyle = {
      opacity: stepAnim,
      transform: [{ translateY: stepAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
    };

    useEffect(() => {
      if (visible) {
        // Pre-select based on trip's stored payment method
        const pre = defaultMethod === 'momo' ? 'mtn' : defaultMethod === 'airtel' ? 'airtel' : null;
        setMethod(pre);
        setPaid(false);
      } else {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    }, [visible]);

    // Poll for driver confirmation
    useEffect(() => {
      if (!paid || !trip?.id) return;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await supabase.from('trips').select('status, payment_status').eq('id', trip.id).single();
          if (data?.status === 'completed') {
            clearInterval(pollRef.current); pollRef.current = null;
            onClose();
          }
        } catch {}
      }, 4000);
      return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    }, [paid]);

    const hasMTN = !!(driverProfile?.momo_number || driverProfile?.momo_merchant_code);
    const hasAirtel = !!(driverProfile?.airtel_number);
    const hasAnyPayment = hasMTN || hasAirtel;

    const amount = trip?.final_price || trip?.price || 0;

    // If passenger selected Airtel but driver only has MTN → auto-fallback
    const effectiveMethod = (method === 'airtel' && !hasAirtel && hasMTN) ? 'mtn' : method;
    const showMTNFallbackNotice = method === 'airtel' && !hasAirtel && hasMTN;

    const handleMobilePay = (source) => {
      if (!hasAnyPayment) {
        showBanner('⚠️ MotoLink', t.noPaymentWarning || 'Driver has no mobile money account set up.', 'warning');
        return;
      }
      const ussd = buildUSSD(source, driverProfile, amount);
      if (!ussd) {
        showBanner('⚠️', 'Driver has not set a payment account for this method.', 'warning');
        return;
      }
      const display = buildUSSDDisplay(source, driverProfile, amount) || '';
      // On mobile browsers (Chrome/Android) a tel: link opens the phone dialer directly,
      // pre-filled with the USSD code — same one-tap experience as the native app.
      if (Platform.OS === 'web') {
        try {
          if (typeof window !== 'undefined' && window?.location) window.location.href = ussd;
          showBanner('📱 Opening dialer…', display, 'info');
        } catch {
          showBanner('📱 Dial on your phone', display, 'info');
        }
        return;
      }
      Linking.openURL(ussd).catch(() => {
        showBanner('📱 Dial manually', display, 'info');
      });
    };

    const getUSSDDisplay = (source) => buildUSSDDisplay(effectiveMethod, driverProfile, amount) || '—';

    const getDriverReceivesLabel = (source) => {
      const m = effectiveMethod;
      if (m === 'mtn') {
        if (driverProfile?.momo_type === 'merchant' && driverProfile?.momo_merchant_code)
          return `MTN Merchant: ${driverProfile.momo_merchant_code}`;
        if (driverProfile?.airtel_number && !driverProfile?.momo_number)
          return `Airtel Money: ${driverProfile.airtel_number}`;
        if (driverProfile?.momo_number)
          return `MTN MoMo: ${driverProfile.momo_number}`;
        return 'No MTN account on file';
      }
      if (m === 'airtel') {
        if (driverProfile?.airtel_number)
          return `Airtel Money: ${driverProfile.airtel_number}`;
        if (driverProfile?.momo_type === 'merchant' && driverProfile?.momo_merchant_code)
          return `MTN Merchant: ${driverProfile.momo_merchant_code}`;
        if (driverProfile?.momo_number)
          return `MTN MoMo: ${driverProfile.momo_number}`;
        return 'No Airtel account on file';
      }
      return '—';
    };

    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={[styles.payModal, { padding: 0, overflow: 'hidden' }, webStyle({ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' })]}>
            {/* Close button */}
            <TouchableOpacity
              onPress={onClose}
              style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
              <Text style={{ color: C.gray, fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>

            <ScrollView
              contentContainerStyle={{ padding: 24, paddingBottom: 32 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={false}>

              {/* Header */}
              <View style={{ alignItems: 'center', marginBottom: 16, marginTop: 8 }}>
                <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
                <Text style={styles.payModalTitle}>{t.paymentPopup || t.choosePayment}</Text>
                <View style={{ backgroundColor: C.goldDim, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 10, marginTop: 10, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ color: C.gray, fontSize: 10, textAlign: 'center', letterSpacing: 1, marginBottom: 2 }}>{t.paymentAmount || 'AMOUNT TO PAY'}</Text>
                  <Text style={{ color: C.gold, fontSize: 28, fontWeight: '900', textAlign: 'center' }}>{fmtFRW(amount)}</Text>
                </View>
              </View>

              {/* Trip summary */}
              {trip && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 12, marginBottom: 14 }}>
                  <Text style={{ color: C.gray, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 6 }}>TRIP SUMMARY</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold, marginTop: 4, marginRight: 8 }} />
                    <Text style={{ color: C.offWhite, fontSize: 12, flex: 1 }} numberOfLines={2}>{trip.pickup_address}</Text>
                  </View>
                  <View style={{ width: 1, height: 10, backgroundColor: C.border, marginLeft: 3, marginBottom: 6 }} />
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.green, marginTop: 4, marginRight: 8 }} />
                    <Text style={{ color: C.white, fontSize: 12, fontWeight: '700', flex: 1 }} numberOfLines={2}>{trip.destination_address}</Text>
                  </View>
                  {trip.discount_amount > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1, borderTopColor: C.borderFaint, marginTop: 6 }}>
                      <Text style={{ color: C.green, fontSize: 11 }}>🎉 Promo discount</Text>
                      <Text style={{ color: C.green, fontWeight: '700', fontSize: 11 }}>-{fmtFRW(trip.discount_amount)}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Driver payment info */}
              {driverProfile && hasAnyPayment && (
                <View style={[styles.driverPayInfo, { marginBottom: 12 }]}>
                  <Text style={styles.driverPayLabel}>{t.paymentInfo}</Text>
                  <Text style={{ color: C.white, fontWeight: '800', fontSize: 14, marginTop: 4 }}>{driverProfile.momo_name}</Text>
                  {hasMTN && (
                    <Text style={{ color: C.mtn, fontSize: 12, marginTop: 2 }}>
                      MTN: {driverProfile.momo_type === 'merchant' ? driverProfile.momo_merchant_code : driverProfile.momo_number}
                    </Text>
                  )}
                  {hasAirtel && (
                    <Text style={{ color: C.airtel, fontSize: 12, marginTop: 2 }}>
                      Airtel: {driverProfile.airtel_number}
                    </Text>
                  )}
                </View>
              )}

              {/* STEP 0 — Choose payment source */}
              {!method && (
                <Animated.View style={[{ gap: 12, marginTop: 8 }, stepEnterStyle]}>
                  <Text style={{ color: C.gray, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }}>
                    {t.passengerPaySource || 'YOUR PAYMENT ACCOUNT'}
                  </Text>

                  {/* MTN MoMo option */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={[
                      styles.payOptionBtn,
                      { borderColor: C.mtn + '55', opacity: hasMTN ? 1 : 0.45 },
                      hasMTN && { shadowColor: C.mtn, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
                    ]}
                    onPress={() => hasMTN ? setMethod('mtn') : showBanner('⚠️', 'Driver has no MTN account set up', 'warning')}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payOptionTitle}>{t.payWithMTN || '📲 MTN MoMo'}</Text>
                      <Text style={styles.payOptionSub}>{getDriverReceivesLabel('mtn')}</Text>
                    </View>
                    <View style={[styles.payOptionBadge, { backgroundColor: 'rgba(255,204,0,0.15)', borderColor: C.mtn }]}>
                      <Text style={{ color: C.mtn, fontWeight: '900', fontSize: 11 }}>MTN</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Airtel Money option */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={[
                      styles.payOptionBtn,
                      { borderColor: C.airtel + '55', opacity: hasAirtel ? 1 : 0.45 },
                      hasAirtel && { shadowColor: C.airtel, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
                    ]}
                    onPress={() => hasAirtel ? setMethod('airtel') : showBanner('⚠️', 'Driver has no Airtel account set up', 'warning')}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payOptionTitle}>{t.payWithAirtel || '📲 Airtel Money'}</Text>
                      <Text style={styles.payOptionSub}>{getDriverReceivesLabel('airtel')}</Text>
                    </View>
                    <View style={[styles.payOptionBadge, { backgroundColor: 'rgba(255,68,68,0.15)', borderColor: C.airtel }]}>
                      <Text style={{ color: C.airtel, fontWeight: '900', fontSize: 11 }}>AIRTEL</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Cash option */}
                  <TouchableOpacity activeOpacity={0.8} style={[styles.payOptionBtn, { borderColor: C.borderFaint }]} onPress={() => { setMethod('cash'); onCash(); }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payOptionTitle}>{t.payViaCash || t.cash}</Text>
                      <Text style={styles.payOptionSub}>{t.fareLabel}: {fmtFRW(amount)}</Text>
                    </View>
                    <Text style={{ fontSize: 24 }}>💵</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* STEP 1 — Mobile money USSD (MTN or Airtel) */}
              {(method === 'mtn' || method === 'airtel') && !paid && (
                <Animated.View style={[{ gap: 12, marginTop: 8 }, stepEnterStyle]}>
                  {/* Network badge */}
                  <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, marginBottom:4 }}>
                    <View style={{
                      backgroundColor: method === 'mtn' ? 'rgba(255,204,0,0.15)' : 'rgba(255,68,68,0.15)',
                      borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6,
                      borderWidth: 1.5, borderColor: method === 'mtn' ? C.mtn : C.airtel,
                    }}>
                      <Text style={{ color: method === 'mtn' ? C.mtn : C.airtel, fontWeight: '900', fontSize: 13 }}>
                        {method === 'mtn' ? '📲 MTN MoMo' : '📲 Airtel Money'}
                      </Text>
                    </View>
                  </View>

                  <View style={[
                    styles.ussdInfoBox,
                    { shadowColor: method === 'mtn' ? C.mtn : C.airtel, shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 3 },
                  ]}>
                    <Text style={{ color: C.gold, fontWeight: '700', fontSize: 13, marginBottom:6 }}>
                      {t.ussdInstructions || 'Dial this USSD code to pay, then tap Confirm below.'}
                    </Text>

                    {/* Fallback notice: Airtel selected but driver has no Airtel */}
                    {showMTNFallbackNotice && (
                      <View style={{ backgroundColor:'rgba(255,204,0,0.1)', borderRadius:10, padding:8, marginBottom:8, borderWidth:1, borderColor:C.mtn+'44' }}>
                        <Text style={{ color:C.mtn, fontSize:11, fontWeight:'700', textAlign:'center' }}>
                          ℹ️ Driver has no Airtel account — showing MTN payment instead
                        </Text>
                      </View>
                    )}

                    {/* USSD code — large monospace, selectable for manual copy */}
                    <Text selectable style={{
                      color: C.white, fontWeight: '900', fontSize: 19,
                      fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
                      letterSpacing: 1.5, textAlign: 'center', paddingVertical: 8,
                      backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8, marginBottom: 4,
                    }}>
                      {getUSSDDisplay(method) || '—'}
                    </Text>

                    <Text style={{ color: C.gray, fontSize: 11, marginTop: 4, textAlign: 'center' }}>
                      Driver receives via: {getDriverReceivesLabel(method)}
                    </Text>

                    {/* One-tap pay — opens the phone dialer pre-filled with the USSD code,
                        on native AND on mobile web (tel: links open the dialer in Chrome/Android) */}
                    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        style={[styles.mainBtn, { marginTop: 12, backgroundColor: method === 'mtn' ? C.mtn : C.airtel }]}
                        onPress={() => handleMobilePay(method)}>
                        <Text style={[styles.mainBtnTxt, { color: C.black }]}>
                          {t.tapToPay || 'Tap to pay'} 📲
                        </Text>
                      </TouchableOpacity>
                    </Animated.View>

                    <View style={{ marginTop: 10, backgroundColor: 'rgba(212,175,55,0.08)', borderRadius: 10, padding: 9, borderWidth: 1, borderColor: C.gold + '33' }}>
                      <Text style={{ color: C.gray, fontSize: 10.5, textAlign: 'center' }}>
                        {Platform.OS === 'web'
                          ? "If your dialer doesn't open automatically, long-press the code above to copy it"
                          : 'Didn\'t dial automatically? Long-press the code above to copy it'}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={[styles.mainBtn, { backgroundColor: C.green }]}
                    onPress={() => { setPaid(true); onPaid(method === 'mtn' ? 'momo' : 'airtel'); }}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.paidBtn}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setMethod(null)} style={{ alignItems: 'center', paddingVertical: 8 }}>
                    <Text style={{ color: C.gray, fontSize: 12 }}>← {t.changePaymentMethod || t.goBack || 'Change payment method'}</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* STEP 2 — Paid, awaiting driver confirmation */}
              {paid && (
                <Animated.View style={[{ alignItems: 'center', gap: 12, marginTop: 8 }, stepEnterStyle]}>
                  <View style={{ backgroundColor: C.greenDim, borderRadius: 16, padding: 18, alignItems: 'center', borderWidth: 1.5, borderColor: C.green, width: '100%' }}>
                    <Text style={{ fontSize: 40, marginBottom: 8 }}>✅</Text>
                    <Text style={{ color: C.green, fontWeight: '900', fontSize: 16, textAlign: 'center', letterSpacing: 0.5 }}>{t.paymentDone || 'Payment Confirmed!'}</Text>
                    <Text style={{ color: C.gray, fontSize: 12, textAlign: 'center', marginTop: 4 }}>{t.passengerPaid || 'Payment received'}</Text>
                  </View>
                  <View style={{ backgroundColor: C.card2, borderRadius: 14, padding: 16, width: '100%' }}>
                    <Text style={{ color: C.gold, fontWeight: '800', fontSize: 13, marginBottom: 6, textAlign: 'center' }}>⏳ {t.awaitingDriverConfirm || 'Awaiting driver confirmation...'}</Text>
                    <Text style={{ color: C.offWhite, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                      {t.driverWaiting || 'The driver will confirm payment receipt. This screen will close automatically once confirmed.'}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={onClose} style={{ paddingVertical: 8 }}>
                    <Text style={{ color: C.gray, fontSize: 12 }}>Dismiss — trip will complete in background</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}

            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  // ══════════════════════════════════════════════
  // 13. DRIVER PAYMENT SETUP MODAL
  // ══════════════════════════════════════════════
  const PaymentSetupModal = ({
    visible,
    profile,
    t,
    onSave,
    onClose
  }) => {
    const [momoType,
      setMomoType] = useState(profile?.momo_type || 'personal');
    const [momoNum,
      setMomoNum] = useState(profile?.momo_number || '');
    const [merchantCode,
      setMerchantCode] = useState(profile?.momo_merchant_code || '');
    const [momoName,
      setMomoName] = useState(profile?.momo_name || '');
    const [airtelNum,
      setAirtelNum] = useState(profile?.airtel_number || '');
    const [loading,
      setLoading] = useState(false);

    const handleSave = async()=> {
      if (!momoName) return showBanner('MotoLink', t.accountHolder + ' required', 'warning');
      if (momoType === 'personal' && !momoNum && !airtelNum)
        return showBanner('MotoLink', t.momoNumber + ' / ' + t.airtelNumber + ' required', 'warning');
      if (momoType === 'merchant' && !merchantCode)
        return showBanner('MotoLink', t.merchantCode + ' required', 'warning');
      setLoading(true);
      await onSave({
        momo_type: momoType,
        momo_number: momoNum,
        momo_merchant_code: merchantCode,
        momo_name: momoName,
        airtel_number: airtelNum,
      });
      setLoading(false);
      onClose();
    };

    // Determine USSD preview for MTN side
    const mtnUSSD = momoType === 'merchant'
      ? `*182*8*1*${merchantCode || 'CODE'}*AMOUNT#`
      : momoNum ? `*182*1*1*${momoNum}*AMOUNT#` : null;
    const airtelUSSD = airtelNum ? `*182*1*1*${airtelNum}*AMOUNT#` : null;

    return (
      <Modal visible={visible} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding': 'height'} style={ { flex: 1 }}>
          <View style={styles.modalBg}>
            <ScrollView contentContainerStyle={styles.glassModal} keyboardShouldPersistTaps="handled">
              <View style={ { alignItems: 'center', marginBottom: 20, position: 'relative' }}>
                <TouchableOpacity
                  onPress={onClose}
                  style={ { position: 'absolute', top: -4, right: -4, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' }}
                  >
                  <Text style={ { color: C.gray, fontSize: 16, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
                <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
                <Text style={[styles.splashTitle, { fontSize: 20 }]}>{t.paymentSetup}</Text>
                <Text style={ { color: C.gray, fontSize: 13, textAlign: 'center', marginTop: 6 }}>{t.paymentRequired}</Text>
              </View>

              {/* Section header: MTN MoMo */}
              <View style={{ flexDirection:'row', alignItems:'center', marginBottom:12, gap:8 }}>
                <View style={{ flex:1, height:1, backgroundColor:C.border }} />
                <Text style={{ color:C.mtn, fontWeight:'900', fontSize:12, letterSpacing:1 }}>📲 MTN MoMo</Text>
                <View style={{ flex:1, height:1, backgroundColor:C.border }} />
              </View>

              {/* Type toggle */}
              <Text style={styles.inputLabel}>{t.momoType}</Text>
              <View style={ { flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                {['personal', 'merchant'].map(tp => (
                  <TouchableOpacity key={tp} style={[styles.methodBtn, momoType === tp && { borderColor: C.gold, backgroundColor: C.goldDim }]}
                    onPress={()=>setMomoType(tp)}>
                    <Text style={[styles.methodTxt, momoType === tp && { color: C.gold }]}>{tp === 'personal'?t.personal: t.merchant}</Text>
                    {momoType === tp && <Text style={ { color: C.gold }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>{t.accountHolder}</Text>
                <TextInput style={styles.input} placeholder="e.g. Jean Pierre" placeholderTextColor={C.grayDark} value={momoName} onChangeText={setMomoName} />
              </View>

              {momoType === 'personal'?(
                <View style={styles.inputWrap}>
                  <Text style={styles.inputLabel}>{t.momoNumber}</Text>
                  <TextInput style={styles.input} placeholder="+250 78X XXX XXX" placeholderTextColor={C.grayDark} value={momoNum} onChangeText={setMomoNum} keyboardType="phone-pad" />
                </View>
              ): (
                <View style={styles.inputWrap}>
                  <Text style={styles.inputLabel}>{t.merchantCode}</Text>
                  <TextInput style={styles.input} placeholder="e.g. 123456" placeholderTextColor={C.grayDark} value={merchantCode} onChangeText={setMerchantCode} keyboardType="numeric" />
                </View>
              )}

              {/* Section header: Airtel Money */}
              <View style={{ flexDirection:'row', alignItems:'center', marginBottom:12, marginTop:8, gap:8 }}>
                <View style={{ flex:1, height:1, backgroundColor:C.border }} />
                <Text style={{ color:C.airtel, fontWeight:'900', fontSize:12, letterSpacing:1 }}>📲 Airtel Money</Text>
                <View style={{ flex:1, height:1, backgroundColor:C.border }} />
              </View>

              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>{t.airtelNumber}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="+250 73X XXX XXX"
                  placeholderTextColor={C.grayDark}
                  value={airtelNum}
                  onChangeText={setAirtelNum}
                  keyboardType="phone-pad"
                />
              </View>

              {/* USSD Preview */}
              {(mtnUSSD || airtelUSSD) && (
                <View style={styles.ussdInfoBox}>
                  <Text style={ { color: C.gold, fontWeight: '700', fontSize: 12, marginBottom:6 }}>USSD Preview</Text>
                  {mtnUSSD && (
                    <View style={{marginBottom:4}}>
                      <Text style={{ color:C.mtn, fontSize:10, fontWeight:'800', letterSpacing:0.5 }}>MTN MoMo</Text>
                      <Text style={ { color: C.gray, fontSize: 12, fontFamily: 'monospace' }}>{mtnUSSD}</Text>
                    </View>
                  )}
                  {airtelUSSD && (
                    <View>
                      <Text style={{ color:C.airtel, fontSize:10, fontWeight:'800', letterSpacing:0.5 }}>Airtel Money</Text>
                      <Text style={ { color: C.gray, fontSize: 12, fontFamily: 'monospace' }}>{airtelUSSD}</Text>
                    </View>
                  )}
                </View>
              )}

              <TouchableOpacity style={styles.mainBtn} onPress={handleSave} disabled={loading}>
                {loading?<ActivityIndicator color={C.black} />: <Text style={styles.mainBtnTxt}>{t.savePayment.toUpperCase()}</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={ { marginTop: 14 }}>
                <Text style={ { color: C.gray, textAlign: 'center', fontSize: 13 }}>{t.close}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  // ══════════════════════════════════════════════
  // 14. MORPHING MENU & SPLASH
  // ══════════════════════════════════════════════
  // RECEIPT PDF GENERATOR
  // ══════════════════════════════════════════════
  const generateReceiptHTML = (trip, role) => {
    const isDriver = role === 'driver';
    const commission = trip.commission || Math.round((trip.price || 0)*0.10);
    const driverEarn = trip.driver_earnings || ((trip.price || 0) - commission);
    const stars = isDriver ? trip.driver_rating: trip.passenger_rating;
    const starsStr = stars ? '★'.repeat(stars)+'☆'.repeat(5-stars): 'Not rated';

    return `<!DOCTYPE html><html>
    <head><meta charset="utf-8"/>
    <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Helvetica Neue',sans-serif;background:#fff;color:#222;padding:40px;}
    .header{background:#0A0A0A;color:#D4AF37;padding:28px 32px;border-radius:12px;margin-bottom:28px;display:flex;align-items:center;gap:16px;}
    .logo{width:52px;height:52px;border-radius:26px;border:2px solid #D4AF37;background:rgba(212,175,55,0.15);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#D4AF37;}
    .brand{font-size:26px;font-weight:900;letter-spacing:4px;}
    .subtitle{font-size:13px;color:#A0A0A0;margin-top:4px;letter-spacing:1px;}
    .section{background:#F8F8F8;border-radius:10px;padding:20px 24px;margin-bottom:16px;border-left:4px solid #D4AF37;}
    .section-title{font-size:11px;font-weight:700;color:#A0A0A0;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;}
    .row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #EFEFEF;}
    .row:last-child{border-bottom:none;}
    .label{font-size:13px;color:#666;}
    .value{font-size:13px;font-weight:600;color:#222;text-align:right;max-width:60%;}
    .fare-total{font-size:22px;font-weight:900;color:#D4AF37;}
    .route-box{background:#0A0A0A;color:#fff;border-radius:10px;padding:18px 20px;margin-bottom:16px;}
    .route-label{font-size:11px;color:#A0A0A0;letter-spacing:1px;margin-bottom:6px;}
    .route-addr{font-size:14px;font-weight:600;color:#fff;}
    .route-arrow{text-align:center;color:#D4AF37;font-size:18px;margin:8px 0;}
    .status{display:inline-block;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.5px;}
    .completed{background:#e8f8f0;color:#2ECC71;}
    .cancelled{background:#fff0f0;color:#FF4C4C;}
    .stars{color:#D4AF37;font-size:18px;}
    .footer{text-align:center;color:#CCC;font-size:11px;margin-top:28px;padding-top:20px;border-top:1px solid #EEE;}
    </style></head>
    <body>
    <div class="header">
    <div class="logo">ML</div>
    <div>
    <div class="brand">MOTOLINK</div>
    <div class="subtitle">Official Trip Receipt</div>
    </div>
    </div>

    <div class="route-box">
    <div class="route-label">PICKUP</div>
    <div class="route-addr">📍 ${trip.pickup_address || '—'}</div>
    <div class="route-arrow">↓</div>
    <div class="route-label">DESTINATION</div>
    <div class="route-addr">🟢 ${trip.destination_address || '—'}</div>
    </div>

    <div class="section">
    <div class="section-title">Trip Details</div>
    <div class="row"><span class="label">Trip ID</span><span class="value" style="font-size:11px;color:#999;">${trip.id}</span></div>
    <div class="row"><span class="label">Date</span><span class="value">${trip.created_at ? new Date(trip.created_at).toLocaleDateString([], {
      day: '2-digit', month: 'long', year: 'numeric'
    }): '—'}</span></div>
    <div class="row"><span class="label">Time</span><span class="value">${trip.created_at ? new Date(trip.created_at).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit'
    }): '—'}</span></div>
    <div class="row"><span class="label">Status</span><span class="status ${trip.status === 'completed'?'completed': 'cancelled'}">${(trip.status || '').toUpperCase()}</span></div>
    <div class="row"><span class="label">Payment Method</span><span class="value">${trip.payment_method === 'momo'?'📲 MTN MoMo': trip.payment_method === 'airtel' ? '📲 Airtel Money' : '💵 Cash'}</span></div>
    <div class="row"><span class="label">Passenger</span><span class="value">${trip.passenger_name || '—'}</span></div>
    <div class="row"><span class="label">Driver</span><span class="value">${trip.driver_name || '—'}</span></div>
    </div>

    <div class="section">
    <div class="section-title">Fare Breakdown</div>
    <div class="row"><span class="label">Total Fare</span><span class="fare-total">${(trip.price || 0).toLocaleString()} FRW</span></div>
    <div class="row"><span class="label">Platform Commission (10%)</span><span class="value" style="color:#FF4C4C;">-${commission.toLocaleString()} FRW</span></div>
    <div class="row"><span class="label">Driver Earnings</span><span class="value" style="color:#2ECC71;">${driverEarn.toLocaleString()} FRW</span></div>
    </div>

    ${stars ? `<div class="section">
    <div class="section-title">Rating</div>
    <div class="row"><span class="label">${isDriver?'Passenger rated driver': 'Driver rated passenger'}</span><span class="stars">${starsStr}</span></div>
    </div>`: ''}

    <div class="footer">
    MotoLink — The Future of Ride-Hailing in Rwanda<br/>
    www.motolink.rw · support@motolink.rw · +250 796 111 433<br/>
    Generated ${new Date().toLocaleString()}
    </div>
    </body></html>`;
  };

  const shareReceiptPDF = async (trip, role) => {
    if (Platform.OS === 'web') {
      // On web, open the receipt HTML in a new tab for printing
      try {
        const html = generateReceiptHTML(trip, role);
        const blob = new Blob([html], {
          type: 'text/html'
        });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } catch {
        showBanner('MotoLink', 'Could not generate receipt.', 'error');
      }
      return;
    }
    try {
      const html = generateReceiptHTML(trip, role);
      const {
        uri
      } = await Print.printToFileAsync({
          html, base64: false
        });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `MotoLink Receipt — ${trip.id?.substring(0, 8)}`,
        UTI: 'com.adobe.pdf',
      });
    } catch (e) {
      showBanner('MotoLink', 'Could not generate PDF. Please try again.', 'error');
    }
  };

  const shareReceiptWhatsApp = (trip, role) => {
    const isDriver = role === 'driver';
    const commission = trip.commission || Math.round((trip.price || 0)*0.10);
    const driverEarn = trip.driver_earnings || ((trip.price || 0) - commission);
    const stars = isDriver ? trip.driver_rating: trip.passenger_rating;
    const starsStr = stars ? '★'.repeat(stars)+'☆'.repeat(5-stars): 'Not rated';
    const msg = encodeURIComponent(
      `🧾 *MotoLink Trip Receipt*\n\n` +
      `📍 From: ${trip.pickup_address || '—'}\n` +
      `🟢 To: ${trip.destination_address || '—'}\n\n` +
      `📅 ${trip.created_at ? new Date(trip.created_at).toLocaleDateString([], {
        day: '2-digit', month: 'short', year: 'numeric'
      }): '—'} ` +
      `🕐 ${trip.created_at ? new Date(trip.created_at).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit'
      }): '—'}\n\n` +
      `💰 Fare: ${(trip.price || 0).toLocaleString()} FRW\n` +
      `💳 Payment: ${trip.payment_method === 'momo'?'MTN MoMo': trip.payment_method === 'airtel' ? 'Airtel Money' : 'Cash'}\n` +
      (isDriver ? `📊 Your earnings: ${driverEarn.toLocaleString()} FRW\n`: '') +
      `⭐ Rating: ${starsStr}\n\n` +
      `🏍️ Driver: ${trip.driver_name || '—'}\n` +
      `👤 Passenger: ${trip.passenger_name || '—'}\n\n` +
      `🔑 Trip ID: ${trip.id?.substring(0, 12)}...\n` +
      `_MotoLink — The Future of Ride-Hailing_`
    );
    Linking.openURL(`https://wa.me/?text=${msg}`)
    .catch(() => showBanner('MotoLink', 'WhatsApp not found. Please install WhatsApp.', 'error'));
  };

  // ══════════════════════════════════════════════
  // TRIP HISTORY MODAL
  // ══════════════════════════════════════════════
  const TripHistoryModal = ({
    visible,
    onClose,
    userId,
    role,
    t,
    onCompleteTrip,
    onCancelTrip,
    onConfirmPayment
  }) => {
    const [trips,
      setTrips] = useState([]);
    const [activeTrips,
      setActiveTrips] = useState([]);
    const [loading,
      setLoading] = useState(false);
    const [page,
      setPage] = useState(0);
    const [hasMore,
      setHasMore] = useState(true);
    const [expandedId,
      setExpandedId] = useState(null);
    const [summary,
      setSummary] = useState( {
        totalEarnings: 0, totalTrips: 0
      });
    const [histTab,
      setHistTab] = useState('active'); // 'active' | 'history'
    const PAGE_SIZE = 20;

    useEffect(() => {
      if (visible) {
        setTrips([]); setPage(0); setHasMore(true);
        loadActiveTrips();
        loadTrips(0, true);
      }
    },
      [visible]);

    const loadActiveTrips = async () => {
      const activeStatuses = ['searching', 'accepted', 'completion_requested', 'awaiting_driver_confirm'];
      let q = supabase.from('trips').select('*').in('status',
        activeStatuses).order('created_at',
        {
          ascending: false
        });
      if (role === 'passenger') q = q.eq('passenger_id', userId);
      else q = q.eq('driver_id', userId);
      const {
        data
      } = await q;
      setActiveTrips(data || []);
    };

    const loadTrips = async (pageNum, reset = false) => {
      if (loading) return;
      setLoading(true);
      const from = pageNum * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let q = supabase.from('trips').select('*')
      .in('status', ['completed', 'cancelled'])
      .order('created_at', {
        ascending: false
      })
      .range(from, to);

      if (role === 'passenger') q = q.eq('passenger_id', userId);
      else q = q.eq('driver_id', userId);

      const {
        data,
        error
      } = await q;
      setLoading(false);
      if (error || !data) return;

      const fetched = data || [];
      setTrips(prev => reset ? fetched: [...prev, ...fetched]);
      setHasMore(fetched.length === PAGE_SIZE);

      if (reset && role === 'driver') {
        const {
          data: all
        } = await supabase.from('trips')
        .select('driver_earnings').eq('driver_id', userId).eq('status', 'completed');
        const totalEarnings = (all || []).reduce((s, tr)=>s+(tr.driver_earnings || 0), 0);
        setSummary({
          totalEarnings, totalTrips: all?.length || 0
        });
      }
      if (reset && role === 'passenger') {
        const {
          count
        } = await supabase.from('trips')
        .select('*', {
          count: 'exact', head: true
        }).eq('passenger_id', userId).eq('status', 'completed');
        setSummary({
          totalEarnings: 0, totalTrips: count || 0
        });
      }
    };

    const loadMore = () => {
      const nextPage = page + 1;
      setPage(nextPage);
      loadTrips(nextPage);
    };

    const fmtDate = (iso) => {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString([], {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    };

    return (
      <Modal visible={visible} animationType="slide" transparent={false} statusBarTranslucent>
        <View style={styles.historyScreen}>
          <StatusBar barStyle="light-content" backgroundColor={C.black} />
          {/* Header */}
          <SafeAreaView edges={['top']} style={styles.historyHeader}>
            <View style={ { flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
              <Text style={styles.historyTitle}>{t.tripHistory}</Text>
              <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { marginLeft: 'auto' }]}>
                <Text style={ { color: C.gray, fontSize: 20 }}>✕</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Driver summary card */}
          {role === 'driver' && (
            <View style={styles.historySummary}>
              <View style={ { flex: 1, alignItems: 'center' }}>
                <Text style={styles.summaryValue}>{fmtFRW(summary.totalEarnings)}</Text>
                <Text style={styles.summaryLabel}>{t.totalEarnings}</Text>
              </View>
              <View style={styles.summarySep} />
              <View style={ { flex: 1, alignItems: 'center' }}>
                <Text style={styles.summaryValue}>{summary.totalTrips}</Text>
                <Text style={styles.summaryLabel}>{t.totalTrips}</Text>
              </View>
            </View>
          )}
          {/* Passenger summary */}
          {role === 'passenger' && (
            <View style={styles.historySummary}>
              <View style={ { flex: 1, alignItems: 'center' }}>
                <Text style={styles.summaryValue}>{summary.totalTrips}</Text>
                <Text style={styles.summaryLabel}>{t.totalTrips}</Text>
              </View>
            </View>
          )}

          {/* Active / History tab toggle */}
          <View style={styles.histTabRow}>
            <TouchableOpacity style={[styles.histTab, histTab === 'active' && styles.histTabActive]}
              onPress={()=>setHistTab('active')}>
              <Text style={[styles.histTabTxt, histTab === 'active' && { color: C.gold }]}>
                🔴 {t.activeJob} {activeTrips.length > 0?`(${activeTrips.length})`: ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.histTab, histTab === 'history' && styles.histTabActive]}
              onPress={()=>setHistTab('history')}>
              <Text style={[styles.histTabTxt, histTab === 'history' && { color: C.gold }]}>
                🕐 {t.tripHistory}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Trip list */}
          <ScrollView style={ { flex: 1 }} showsVerticalScrollIndicator={false}>

            {/* ── ACTIVE MISSIONS TAB ── */}
            {histTab === 'active' && (
              <>
                {activeTrips.length === 0 && (
                  <View style={ { alignItems: 'center', marginTop: 60 }}>
                    <Text style={ { fontSize: 48, marginBottom: 12 }}>🛵</Text>
                    <Text style={styles.emptyText}>{t.noRequests}</Text>
                  </View>
                )}
                {activeTrips.map(trip => {
                  const isDriver = role === 'driver';
                  const statusColor =
                  trip.status === 'accepted' ? C.green:
                  trip.status === 'completion_requested' ? C.blue:
                  trip.status === 'awaiting_driver_confirm' ? C.orange:
                  C.gold;
                  const statusLabel =
                  trip.status === 'searching' ? t.pending:
                  trip.status === 'accepted' ? t.accepted:
                  trip.status === 'completion_requested' ? t.confirmComplete:
                  trip.status === 'awaiting_driver_confirm' ? (isDriver ? t.driverConfirm: t.awaitingDriverConfirm):
                  trip.status;

                  return (
                    <View key={trip.id} style={[styles.historyCard, { borderColor: statusColor+'44' }]}>
                      {/* Status */}
                      <View style={[styles.statusPill, { backgroundColor: statusColor+'22', marginTop: 0, marginBottom: 10 }]}>
                        <Text style={[styles.statusPillTxt, { color: statusColor }]}>{statusLabel}</Text>
                      </View>
                      {/* Route */}
                      <View style={styles.routeBlock}>
                        <View style={styles.routeDot} />
                        <Text style={ { color: C.gray, fontSize: 12, flex: 1 }} numberOfLines={1}>{trip.pickup_address}</Text>
                      </View>
                      <View style={styles.routeLine_} />
                      <View style={styles.routeBlock}>
                        <View style={[styles.routeDot, { backgroundColor: C.green }]} />
                        <Text style={ { color: C.offWhite, fontSize: 12, flex: 1 }} numberOfLines={1}>{trip.destination_address}</Text>
                      </View>
                      {/* Fare + time */}
                      <View style={ { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                        <Text style={ { color: C.gold, fontWeight: '900', fontSize: 15 }}>{fmtFRW(trip.price)}</Text>
                        <Text style={ { color: C.grayDark, fontSize: 11 }}>{fmtDateTime(trip.created_at)}</Text>
                      </View>
                      {/* Counterparty */}
                      <Text style={ { color: C.gray, fontSize: 12, marginTop: 4 }}>
                        {isDriver ? `👤 ${trip.passenger_name || 'Passenger'}`: `🏍️ ${trip.driver_name || 'Searching...'}`}
                      </Text>
                      {/* Action buttons */}
                      <View style={ { flexDirection: 'row', gap: 8, marginTop: 12 }}>
                        {/* Driver actions */}
                        {isDriver && trip.status === 'accepted' && (
                          <>
                            <TouchableOpacity style={[styles.histActionBtn, { borderColor: C.blue, flex: 1 }]}
                              onPress={()=> { onCompleteTrip && onCompleteTrip(trip); onClose(); }}>
                              <Text style={[styles.histActionTxt, { color: C.blue }]}>{t.arrivedBtn}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.histActionBtn, { borderColor: C.red }]}
                              onPress={()=> { onCancelTrip && onCancelTrip(trip.id, trip.passenger_id); onClose(); }}>
                              <Text style={[styles.histActionTxt, { color: C.red }]}>✕</Text>
                            </TouchableOpacity>
                          </>
                        )}
                        {isDriver && trip.status === 'awaiting_driver_confirm' && (
                          <TouchableOpacity style={[styles.histActionBtn, { borderColor: C.green, flex: 1 }]}
                            onPress={()=> { onConfirmPayment && onConfirmPayment(trip); onClose(); }}>
                            <Text style={[styles.histActionTxt, { color: C.green }]}>💰 {t.driverConfirm}</Text>
                          </TouchableOpacity>
                        )}
                        {/* Passenger actions */}
                        {!isDriver && trip.status === 'completion_requested' && (
                          <TouchableOpacity style={[styles.histActionBtn, { borderColor: C.green, flex: 1 }]}
                            onPress={()=> { onConfirmPayment && onConfirmPayment(trip); onClose(); }}>
                            <Text style={[styles.histActionTxt, { color: C.green }]}>✅ {t.confirmComplete}</Text>
                          </TouchableOpacity>
                        )}
                        {!isDriver && ['searching', 'accepted'].includes(trip.status) && (
                          <TouchableOpacity style={[styles.histActionBtn, { borderColor: C.red }]}
                            onPress={()=> { onCancelTrip && onCancelTrip(trip.id, trip.driver_id || null); onClose(); }}>
                            <Text style={[styles.histActionTxt, { color: C.red }]}>{t.cancelTrip}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {/* ── HISTORY TAB ── */}
            {histTab === 'history' && (
              <>
                {loading && trips.length === 0 && (
                  <ActivityIndicator color={C.gold} size="large" style={ { marginTop: 60 }} />
                )}
                {!loading && trips.length === 0 && (
                  <View style={ { alignItems: 'center', marginTop: 80 }}>
                    <Text style={ { fontSize: 48, marginBottom: 12 }}>🛵</Text>
                    <Text style={styles.emptyText}>{t.noHistory}</Text>
                  </View>
                )}
                {trips.map(trip => {
                  const isExpanded = expandedId === trip.id;
                  const commission = trip.commission || Math.round((trip.price || 0)*0.10);
                  const driverEarn = trip.driver_earnings || ((trip.price || 0)-commission);
                  const myRating = role === 'driver' ? trip.driver_rating: trip.passenger_rating;
                  const isCompleted = trip.status === 'completed';

                  return (
                    <TouchableOpacity key={trip.id} style={styles.historyCard}
                      onPress={()=>setExpandedId(isExpanded ? null: trip.id)} activeOpacity={0.85}>
                      {/* Card top row */}
                      <View style={ { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                        <View style={[styles.statusPill, {
                          backgroundColor: isCompleted?C.greenDim: C.redDim,
                          marginTop: 0, paddingVertical: 3, paddingHorizontal: 8,
                        }]}>
                          <Text style={[styles.statusPillTxt, { color: isCompleted?C.green: C.red }]}>
                            {isCompleted?'✓': '✕'}
                          </Text>
                        </View>
                        <View style={ { flex: 1 }}>
                          <Text style={ { color: C.gold, fontWeight: '900', fontSize: 16 }}>
                            {fmtFRW(trip.price)}
                          </Text>
                          <Text style={ { color: C.gray, fontSize: 11, marginTop: 1 }}>
                            {fmtDate(trip.created_at)} · {fmtTime(trip.created_at)}
                          </Text>
                        </View>
                        {role === 'driver' && isCompleted && (
                          <Text style={ { color: C.green, fontWeight: '800', fontSize: 13 }}>
                            +{fmtFRW(driverEarn)}
                          </Text>
                        )}
                        <Text style={ { color: C.grayDark, fontSize: 16 }}>{isExpanded?'▲': '▼'}</Text>
                      </View>

                      {/* Route */}
                      <View style={[styles.routeBlock, { marginTop: 10 }]}>
                        <View style={styles.routeDot} />
                        <Text style={ { color: C.gray, fontSize: 12, flex: 1 }} numberOfLines={1}>
                          {trip.pickup_address}
                        </Text>
                      </View>
                      <View style={styles.routeLine_} />
                      <View style={styles.routeBlock}>
                        <View style={[styles.routeDot, { backgroundColor: C.green }]} />
                        <Text style={ { color: C.offWhite, fontSize: 12, flex: 1 }} numberOfLines={1}>
                          {trip.destination_address}
                        </Text>
                      </View>

                      {/* Expanded receipt view */}
                      {isExpanded && (
                        <View style={styles.receiptExpanded}>
                          <View style={styles.receiptRow}>
                            <Text style={styles.receiptLabel}>{t.tripId}</Text>
                            <Text style={styles.receiptValue} numberOfLines={1}>
                              {trip.id?.substring(0, 16)}...
                            </Text>
                          </View>
                          <View style={styles.receiptRow}>
                            <Text style={styles.receiptLabel}>{role === 'passenger'?t.driver: t.pax}</Text>
                            <Text style={styles.receiptValue}>
                              {role === 'passenger'?(trip.driver_name || '—'): (trip.passenger_name || '—')}
                            </Text>
                          </View>
                          <View style={styles.receiptRow}>
                            <Text style={styles.receiptLabel}>{t.payWith}</Text>
                            <Text style={styles.receiptValue}>
                              {trip.payment_method === 'momo'?'📲 MTN MoMo': trip.payment_method === 'airtel' ? '📲 Airtel Money' : '💵 Cash'}
                            </Text>
                          </View>
                          <View style={styles.receiptRow}>
                            <Text style={styles.receiptLabel}>{t.fareLabel}</Text>
                            <Text style={[styles.receiptValue, { color: C.gold, fontWeight: '900' }]}>
                              {fmtFRW(trip.price)}
                            </Text>
                          </View>
                          <View style={styles.receiptRow}>
                            <Text style={styles.receiptLabel}>{t.commission}</Text>
                            <Text style={[styles.receiptValue, { color: C.red }]}>
                              -{fmtFRW(commission)}
                            </Text>
                          </View>
                          <View style={styles.receiptRow}>
                            <Text style={styles.receiptLabel}>{t.driverEarnings}</Text>
                            <Text style={[styles.receiptValue, { color: C.green }]}>
                              {fmtFRW(driverEarn)}
                            </Text>
                          </View>
                          <View style={styles.receiptRow}>
                            <Text style={styles.receiptLabel}>{t.ratingGiven}</Text>
                            <Text style={styles.receiptValue}>
                              {myRating ? '★'.repeat(myRating)+'☆'.repeat(5-myRating): t.notRated}
                            </Text>
                          </View>

                          {/* Share buttons */}
                          <View style={ { flexDirection: 'row', gap: 10, marginTop: 14 }}>
                            <TouchableOpacity
                              style={[styles.receiptShareBtn, { borderColor: C.green }]}
                              onPress={()=>shareReceiptWhatsApp(trip, role)}>
                              <Text style={[styles.receiptShareTxt, { color: C.green }]}>
                                📲 {t.shareWhatsApp}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.receiptShareBtn, { borderColor: C.gold }]}
                              onPress={()=>shareReceiptPDF(trip, role)}>
                              <Text style={[styles.receiptShareTxt, { color: C.gold }]}>
                                📄 {t.downloadPDF}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Load more */}
                {hasMore && trips.length > 0 && (
                  <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loading}>
                    {loading
                    ? <ActivityIndicator color={C.gold} />: <Text style={styles.loadMoreTxt}>{t.loadMore} ↓</Text>
                    }
                  </TouchableOpacity>
                )}
              </>
            )}
            <View style={ { height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    );
  };

  // ══════════════════════════════════════════════
  // EARNINGS DASHBOARD COMPONENT
  // ══════════════════════════════════════════════
  const EarningsDashboard = ({
    driverId,
    t
  }) => {
    const [period,
      setPeriod] = useState('today');
    const [data,
      setData] = useState(null);
    const [loading,
      setLoading] = useState(false);

    const getPeriodRange = (p) => {
      const now = new Date();
      const start = new Date();
      if (p === 'today') {
        start.setHours(0, 0, 0, 0);
      } else if (p === 'week') {
        const day = now.getDay();
        start.setDate(now.getDate() - (day === 0?6: day-1));
        start.setHours(0, 0, 0, 0);
      } else if (p === 'month') {
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
      } else {
        return null; // all time — no filter
      }
      return start.toISOString();
    };

    const loadEarnings = async (p) => {
      if (!driverId) return;
      setLoading(true);
      const from = getPeriodRange(p);
      let q = supabase.from('trips')
      .select('driver_earnings, price, commission, created_at, passenger_name')
      .eq('driver_id', driverId)
      .eq('status', 'completed')
      .order('created_at', {
        ascending: false
      });
      if (from) q = q.gte('created_at', from);
      const {
        data: trips
      } = await q;
      setLoading(false);
      if (!trips) return;

      const totalEarnings = trips.reduce((s, t) => s+(t.driver_earnings || 0), 0);
      const totalTrips = trips.length;
      const avgPerTrip = totalTrips > 0 ? Math.round(totalEarnings/totalTrips): 0;

      // Find best day
      const byDay = {};
      trips.forEach(tr => {
        const day = new Date(tr.created_at).toLocaleDateString([], {
          weekday: 'short', day: '2-digit', month: 'short'
        });
        byDay[day] = (byDay[day] || 0) + (tr.driver_earnings || 0);
      });
      const peakDay = Object.entries(byDay).sort((a, b)=>b[1]-a[1])[0];

      // Recent 5 trips for mini list
      const recent = trips.slice(0, 5);

      setData({
        totalEarnings, totalTrips, avgPerTrip, peakDay, recent
      });
    };

    useEffect(() => {
      loadEarnings(period);
    }, [period, driverId]);

    const tabs = [{
      key: 'today',
      label: t.today
    },
      {
        key: 'week',
        label: t.thisWeek
      },
      {
        key: 'month',
        label: t.thisMonth
      },
      {
        key: 'all',
        label: t.allTime
      },
    ];

    return (
      <View style={styles.earningsBox}>
        {/* Section header */}
        <View style={styles.earningsHeader}>
          <Text style={styles.earningsSectionTitle}>💰 {t.earningsDash}</Text>
        </View>

        {/* Period tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.earningsTabs}>
          {tabs.map(tab => (
            <TouchableOpacity key={tab.key}
              style={[styles.earningsTab, period === tab.key && styles.earningsTabActive]}
              onPress={() => setPeriod(tab.key)}>
              <Text style={[styles.earningsTabTxt, period === tab.key && { color: C.gold }]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading && <ActivityIndicator color={C.gold} style={ { marginVertical: 16 }} />}

        {!loading && data && (
          <>
            {/* Main stats row */}
            <View style={styles.earningsStatsRow}>
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatVal}>{fmtFRW(data.totalEarnings)}</Text>
                <Text style={styles.earningsStatLbl}>{t.totalEarnings}</Text>
              </View>
              <View style={styles.earningsStatSep} />
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatVal}>{data.totalTrips}</Text>
                <Text style={styles.earningsStatLbl}>{t.tripsCompleted}</Text>
              </View>
              <View style={styles.earningsStatSep} />
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatVal}>{fmtFRW(data.avgPerTrip)}</Text>
                <Text style={styles.earningsStatLbl}>{t.avgPerTrip}</Text>
              </View>
            </View>

            {/* Best day */}
            {data.peakDay && (
              <View style={styles.earningsPeakRow}>
                <Text style={styles.earningsPeakLabel}>🏆 {t.peakDay}</Text>
                <Text style={styles.earningsPeakVal}>
                  {data.peakDay[0]} — {fmtFRW(data.peakDay[1])}
                </Text>
              </View>
            )}

            {/* Recent trips mini list */}
            {data.recent.length === 0 && (
              <Text style={[styles.emptyText, { marginVertical: 12 }]}>{t.noEarnings}</Text>
            )}
            {data.recent.map((tr, i) => (
              <View key={i} style={styles.earningsRecentRow}>
                <View style={ { flex: 1 }}>
                  <Text style={ { color: C.white, fontSize: 12, fontWeight: '700' }}>
                    👤 {tr.passenger_name || 'Passenger'}
                  </Text>
                  <Text style={ { color: C.gray, fontSize: 10, marginTop: 1 }}>
                    {fmtDateTime(tr.created_at)}
                  </Text>
                </View>
                <Text style={ { color: C.green, fontWeight: '900', fontSize: 13 }}>
                  +{fmtFRW(tr.driver_earnings || 0)}
                </Text>
              </View>
            ))}
          </>
        )}
      </View>
    );
  };

  // ── SOS BUTTON — draggable on native (PanResponder) + web (mouse) ──
  const SOSButton = ({
    onPress
  }) => {
    const pulse = useRef(new Animated.Value(1)).current;
    // Start position: right side, middle of screen
    const startX = width - 76;
    const startY = height * 0.42;
    const panX = useRef(new Animated.Value(startX)).current;
    const panY = useRef(new Animated.Value(startY)).current;
    const lastX = useRef(startX);
    const lastY = useRef(startY);
    const isDragging = useRef(false);
    const dragDist = useRef(0);

    // Web drag state
    const webDragStart = useRef(null);
    const webPos = useRef({ x: startX, y: startY });
    const [webXY, setWebXY] = useState({ x: startX, y: startY });

    useEffect(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.32, duration: 900, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      ).start();
    }, []);

    const panResponder = useRef(Platform.OS !== 'web' ? PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        dragDist.current = 0;
        isDragging.current = false;
        // Save current absolute position
        panX.setOffset(lastX.current);
        panX.setValue(0);
        panY.setOffset(lastY.current);
        panY.setValue(0);
      },
      onPanResponderMove: Animated.event(
        [null, { dx: panX, dy: panY }],
        {
          useNativeDriver: false,
          listener: (_, g) => {
            dragDist.current = Math.sqrt(g.dx * g.dx + g.dy * g.dy);
            if (dragDist.current > 5) isDragging.current = true;
          }
        }
      ),
      onPanResponderRelease: (_, g) => {
        panX.flattenOffset();
        panY.flattenOffset();
        // After flatten, the animated value holds offset+delta — read it directly
        const rawX = lastX.current + g.dx;
        const rawY = lastY.current + g.dy;
        const btnSize = 64;
        const clampX = Math.max(8, Math.min(width - btnSize - 8, rawX));
        const clampY = Math.max(90, Math.min(height - btnSize - 120, rawY));
        lastX.current = clampX;
        lastY.current = clampY;
        // Spring snap to clamped position
        Animated.spring(panX, { toValue: clampX, useNativeDriver: false, friction: 6, tension: 100 }).start();
        Animated.spring(panY, { toValue: clampY, useNativeDriver: false, friction: 6, tension: 100 }).start();
        if (dragDist.current < 6) onPress();
      },
      onPanResponderTerminate: (_, g) => {
        panX.flattenOffset();
        panY.flattenOffset();
        // Keep last known position on interrupt
        Animated.spring(panX, { toValue: lastX.current, useNativeDriver: false, friction: 6 }).start();
        Animated.spring(panY, { toValue: lastY.current, useNativeDriver: false, friction: 6 }).start();
      },
    }) : { panHandlers: {} }).current;

    // Web drag
    const handleWebMouseDown = (e) => {
      webDragStart.current = { mx: e.clientX, my: e.clientY, bx: webPos.current.x, by: webPos.current.y };
      isDragging.current = false;
      const onMove = (me) => {
        const dx = me.clientX - webDragStart.current.mx;
        const dy = me.clientY - webDragStart.current.my;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) isDragging.current = true;
        const nx = Math.max(8, Math.min(width - 68, webDragStart.current.bx + dx));
        const ny = Math.max(80, Math.min(height - 160, webDragStart.current.by + dy));
        webPos.current = { x: nx, y: ny };
        setWebXY({ x: nx, y: ny });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!isDragging.current) onPress();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    if (Platform.OS === 'web') {
      return (
        <div onMouseDown={handleWebMouseDown} style={{
          position: 'fixed', left: webXY.x, top: webXY.y,
          width: 60, height: 60, borderRadius: 30,
          backgroundColor: '#FF4C4C', cursor: 'grab',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 8888, userSelect: 'none',
          boxShadow: '0 0 0 10px rgba(255,76,76,0.2)',
          animation: 'sos-pulse 1.8s ease-in-out infinite',
        }}>
          <style>{`@keyframes sos-pulse{0%,100%{box-shadow:0 0 0 10px rgba(255,76,76,0.2)}50%{box-shadow:0 0 0 20px rgba(255,76,76,0.08)}}`}</style>
          <span style={{ color:'#fff', fontWeight:'900', fontSize:13, letterSpacing:1 }}>SOS</span>
        </div>
      );
    }

    return (
      <Animated.View
        style={[styles.sosBtn, { left: panX, top: panY, zIndex: 8888, elevation: 30 }]}
        {...panResponder.panHandlers}
      >
        <Animated.View style={[styles.sosPulse, { transform: [{ scale: pulse }] }]} />
        <Text style={styles.sosBtnTxt}>SOS</Text>
      </Animated.View>
    );
  };

  // ══════════════════════════════════════════════
  const MorphingMenu = ({
    isOpen,
    onPress
  }) => {
    const anim = useRef(new Animated.Value(0)).current;
    useEffect(()=> {
      Animated.spring(anim,
        {
          toValue: isOpen?1: 0,
          useNativeDriver: true,
          friction: 7
        }).start();
    }, [isOpen]);
    const rotTop = anim.interpolate({
      inputRange: [0, 1], outputRange: ['0deg', '45deg']});
    const rotBot = anim.interpolate({
      inputRange: [0, 1], outputRange: ['0deg', '-45deg']});
    const transY = anim.interpolate({
      inputRange: [0, 1], outputRange: [0, 8]});
    const opMid = anim.interpolate({
      inputRange: [0, 0.2], outputRange: [1, 0]});
    return (
      <TouchableOpacity onPress={onPress} style={styles.hamburgerWrap} activeOpacity={0.8}>
        <Animated.View style={[styles.bar, { transform: [{ translateY: transY }, { rotate: rotTop }]}]} />
        <Animated.View style={[styles.bar, { opacity: opMid }]} />
        <Animated.View style={[styles.bar, { transform: [{ translateY: Animated.multiply(transY,
          -1)}, { rotate: rotBot }]}]} />
      </TouchableOpacity>
    );
  };

  const SplashScreen = ({
    onFinish
  }) => {
    const mx = useRef(new Animated.Value(-width)).current;
    const op = useRef(new Animated.Value(1)).current;
    const ly = useRef(new Animated.Value(30)).current;
    const lo = useRef(new Animated.Value(0)).current;
    useEffect(()=> {
      Animated.sequence([
        Animated.parallel([Animated.timing(lo, {
          toValue: 1, duration: 600, useNativeDriver: true
        }), Animated.spring(ly, {
          toValue: 0, useNativeDriver: true, friction: 8
        })]),
        Animated.delay(300),
        Animated.timing(mx, {
          toValue: width*1.2, duration: 1600, easing: Easing.bezier(0.25, 0.1, 0.25, 1), useNativeDriver: true
        }),
        Animated.delay(300),
        Animated.timing(op, {
          toValue: 0, duration: 500, useNativeDriver: true
        }),
      ]).start(()=>onFinish());
    }, []);
    return (
      <Animated.View style={[styles.splashContainer, { opacity: op }]}>
        <Animated.View style={ { transform: [{ translateY: ly }], opacity: lo, alignItems: 'center' }}>
          <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
          <Text style={styles.splashTitle}>MOTOLINK</Text>
          <Text style={styles.splashSlogan}>{LANG.en.slogan}</Text>
        </Animated.View>
        <Animated.View style={ { position: 'absolute', transform: [{ translateX: mx }]}}>
          <Text style={ { fontSize: 64 }}>🛵</Text>
        </Animated.View>
      </Animated.View>
    );
  };

  // ══════════════════════════════════════════════
  // 15. STATE MANAGEMENT
  // ══════════════════════════════════════════════
  const initialState = {
    session: null,
    profile: null,
    step: 'splash',
    lang: 'en',
    role: 'passenger',
    myLocation: null,
    activeTrip: null,
    myTrips: [],
    availableTrips: [],
    menuOpen: false,
    banner: null,
    walletBalance: 0,
    hydrated: false,
    favorites: [],       // saved home/work/frequent destinations
    driverOnline: true,  // driver online/offline toggle
  };

  function reducer(state, action) {
    switch (action.type) {
    case 'SET_SESSION': return {
        ...state,
        session: action.p.session,
        profile: action.p.profile,
        step: 'app',
        walletBalance: action.p.profile?.wallet_balance || 0
      };
    case 'SET_STEP': return {
        ...state,
        step: action.p
      };
    case 'SET_LANG': return {
        ...state,
        lang: action.p
      };
    case 'SET_ROLE': return {
        ...state,
        role: action.p
      };
    case 'SET_PROFILE': return {
        ...state,
        profile: action.p
      };
    case 'SET_LOCATION': return {
        ...state,
        myLocation: action.p
      };
    case 'SET_ACTIVE_TRIP': return {
        ...state,
        activeTrip: action.p
      };
    case 'CLEAR_ACTIVE_TRIP': return {
        ...state,
        activeTrip: null
      };
    case 'SET_MY_TRIPS': return {
        ...state,
        myTrips: action.p
      };
    case 'SET_AVAILABLE_TRIPS': return {
        ...state,
        availableTrips: action.p
      };
    case 'TOGGLE_MENU': return {
        ...state,
        menuOpen: !state.menuOpen
      };
    case 'SHOW_BANNER': return {
        ...state,
        banner: action.p
      };
    case 'HIDE_BANNER': return {
        ...state,
        banner: null
      };
    case 'SET_WALLET': return {
        ...state,
        walletBalance: action.p
      };
    case 'SET_HYDRATED': return {
        ...state,
        hydrated: true
      };
    case 'SET_FAVORITES': return {
        ...state,
        favorites: action.p
      };
    case 'SET_DRIVER_ONLINE': return {
        ...state,
        driverOnline: action.p
      };
    case 'LOGOUT': return {
        ...initialState,
        step: 'auth',
        hydrated: true
      };
    default: return state;
    }
  }

  // ══════════════════════════════════════════════
  // 16. INLINE RATING BADGES
  // ══════════════════════════════════════════════
  const DriverRatingBadge = ({
    driverId
  }) => {
    const [d,
      setD] = useState(null);
    useEffect(()=> {
      if (!driverId)return; supabase.from('profiles').select('rating,total_ratings').eq('id', driverId).single().then(({
        data
      })=>data && setD(data));
    },
      [driverId]);
    if (!d) return null;
    const warn = d.rating < 3.5;
    return (
      <View style={[styles.ratingBadge, warn && { backgroundColor: C.orangeDim, borderColor: C.orange }]}>
        <Text style={[styles.ratingBadgeTxt, warn && { color: C.orange }]}>★ {d.rating.toFixed(1)}{warn?' ⚠️': ''}</Text>
      </View>
    );
  };
  const PassengerRatingBadge = ({
    passengerId
  }) => {
    const [r,
      setR] = useState(null);
    useEffect(()=> {
      if (!passengerId)return; supabase.from('profiles').select('rating').eq('id', passengerId).single().then(({
        data
      })=>data && setR(data.rating));
    },
      [passengerId]);
    if (r === null) return null;
    return <View style={styles.ratingBadge}><Text style={styles.ratingBadgeTxt}>★ {r.toFixed(1)}</Text></View>;
  };

  // ══════════════════════════════════════════════
  // 17. MAIN COMPONENT
  // ══════════════════════════════════════════════
  function MotoLink() {
    const {
      state,
      dispatch
    } = useContext(AppContext);
    const t = LANG[state.lang]; // All UI text from selected language

    // Auth
    const [authMode,
      setAuthMode] = useState('signin');
    const [phone,
      setPhone] = useState('');
    const [password,
      setPassword] = useState('');
    const [confirmPass,
      setConfirmPass] = useState('');
    const [nameVal,
      setNameVal] = useState('');
    const [showPass,
      setShowPass] = useState(false);
    const [showConfirm,
      setShowConfirm] = useState(false);
    const [refCodeInput,
      setRefCodeInput] = useState(''); // referral code entered at signup

    // Loading (independent)
    const [authLoading,
      setAuthLoading] = useState(false);
    const [searchLoading,
      setSearchLoading] = useState(false);
    const [rideLoading,
      setRideLoading] = useState(false);

    // UI
    const [profileModal,
      setProfileModal] = useState(false);
    const [paySetupModal,
      setPaySetupModal] = useState(false);
    const [paymentModal,
      setPaymentModal] = useState(false);
    const [ratingModal,
      setRatingModal] = useState(false);
    const [tripToRate,
      setTripToRate] = useState(null);
    const [idScanModal,
      setIdScanModal] = useState(false);
    const [idScanMandatory, setIdScanMandatory] = useState(false); // true = required at signup, hides skip/close
    const [idScanData, setIdScanData] = useState({
      idNumber:'', fullName:'', dob:'', origin:'', idPhotoUri:'', permitPhotoUri:'', profilePhotoUri:''
    });
    const [driverPayProfile,
      setDriverPayProfile] = useState(null);
    const [searchQuery,
      setSearchQuery] = useState('');
    const [suggestions,
      setSuggestions] = useState([]);
    const [destCoords,
      setDestCoords] = useState(null);
    const [destName,
      setDestName] = useState('');
    const [targetLocation,
      setTargetLocation] = useState(null);
    const [paymentMethod,
      setPaymentMethod] = useState('cash');
    const [sosModal,
      setSosModal] = useState(false);
    const [historyModal,
      setHistoryModal] = useState(false);
    const [surgeMultiplier,
      setSurgeMultiplier] = useState(1.0);
    const [surgeActive,
      setSurgeActive] = useState(false);
    const [promoCode,
      setPromoCode] = useState('');
    const [promoData,
      setPromoData] = useState(null);
    const [promoLoading,
      setPromoLoading] = useState(false);
    // Scheduled rides
    const [tripMode,
      setTripMode] = useState('now'); // 'now' | 'later'
    const [scheduledFor,
      setScheduledFor] = useState(null);
    const [showDatePicker,
      setShowDatePicker] = useState(false);
    // Multi-stop
    const [stops,
      setStops] = useState([]); // [{name,lat,lng}]
    // Package delivery
    const [serviceMode,
      setServiceMode] = useState('ride'); // 'ride' | 'delivery'
    const [packageDesc,
      setPackageDesc] = useState('');
    const [recipientName,
      setRecipientName] = useState('');
    const [recipientPhone,
      setRecipientPhone] = useState('');
    // Panel tab state — hoisted here to comply with Rules of Hooks
    const [paxTab,
      setPaxTab] = useState('active'); // 'active' | 'scheduled'
    const [driverTab,
      setDriverTab] = useState('available'); // 'available' | 'scheduled'
    // B2B
    const [companyCode,
      setCompanyCode] = useState('');
    const [companyData,
      setCompanyData] = useState(null);
    // Offline
    const [isOnline,
      setIsOnline] = useState(true);
    const [offlineQueue,
      setOfflineQueue] = useState([]);
    // Leaderboard
    const [leaderboard,
      setLeaderboard] = useState([]);
    const [showLeaderboard,
      setShowLeaderboard] = useState(false);
    const [pickupAddress,
      setPickupAddress] = useState('');
    const [showAIChat,
      setShowAIChat] = useState(false);

    // ── New feature state ──────────────────────────────────────────────────
    const [showTOS, setShowTOS] = useState(false);          // Terms of Service modal
    const [showPrivacy, setShowPrivacy] = useState(false);  // Privacy Policy modal
    const [tosAccepted, setTosAccepted] = useState(false);  // TOS accepted flag
    const [showFavorites, setShowFavorites] = useState(false); // Favorites manager
    // ── Favorites editing state ──────────────────────────────────────────
    const [favEditKey, setFavEditKey] = useState(null);       // Which fav slot is being edited
    const [favEditMode, setFavEditMode] = useState(null);     // 'current' | 'manual' | 'search'
    const [favManualText, setFavManualText] = useState('');   // Manual address typed
    const [favCurrentResolving, setFavCurrentResolving] = useState(false); // Resolving GPS → place name
    const [favCurrentResolvedName, setFavCurrentResolvedName] = useState(''); // Pre-resolved place name
    const [favSearchQuery, setFavSearchQuery] = useState(''); // Search query in fav picker
    const [favSearchResults, setFavSearchResults] = useState([]); // Search results in fav picker
    const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false); // Delete account confirm
    const [showShareTrip, setShowShareTrip] = useState(false); // Trip sharing modal
    const [showVersionAlert, setShowVersionAlert] = useState(false); // Force update
    const [driverNoteText, setDriverNoteText] = useState(''); // Passenger note to driver
    const [speedWarned, setSpeedWarned] = useState(false);  // Speed alert sent flag
    const speedRef = useRef(0);                              // Current GPS speed m/s
    const justSignedUpRef = useRef(false);                   // Flag: TOS shows only right after signup

    // ── AI Tooltip pop-up state ──────────────────────────────────────────
    const [aiTooltipVisible,
      setAiTooltipVisible] = useState(false);
    const aiTooltipAnim = useRef(new Animated.Value(0)).current; // 0=hidden 1=shown
    const aiTooltipScaleX = useRef(new Animated.Value(0)).current; // bubble grow
    const aiTooltipMsgIdx = useRef(0);
    const aiTooltipTimer = useRef(null);
    const aiTooltipHideTimer = useRef(null);

    // ── Active-trip bottom sheet collapse (Spotify-style pull-down) ──────────
    const tripSheetAnim     = useRef(new Animated.Value(0)).current;
    const tripSheetIsMin    = useRef(false);
    const tripDragStartY    = useRef(null);
    const TRIP_COLLAPSED    = height * 0.72 - 76; // translate-Y to show only handle+banner

    const menuAnim = useRef(new Animated.Value(-900)).current;
    const searchTimer = useRef(null);
    const myLocRef = useRef(null); // Always holds latest location for search debounce
    const appStateRef = useRef(Platform.OS !== 'web' ? AppState.currentState: 'active');
    const [searchBarBottom,
      setSearchBarBottom] = useState(
      Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 120: 140
    );
    // ── Map bridge ref — lets MotoLink send messages to the WebView map ──
    const mapBridgeRef = useRef(null);
    const sendToMap = (msg) => {
      if (mapBridgeRef.current?.postMessage) {
        mapBridgeRef.current.postMessage(msg);
      }
    };

    // ─── Banner helper ───────────────────────
    const showBanner = useCallback((title, body, type = 'default')=> {
      dispatch( {
        type: 'SHOW_BANNER', p: {
          title, body, type
        }});
    }, []);

    const notify = useCallback(async(title, body, type, recipientId = null)=> {
      showBanner(title, body, type);
      await Notifications.scheduleNotificationAsync({
        content: {
          title, body, sound: true
        }, trigger: null
      });
      if (recipientId) {
        const tk = await getPushToken(recipientId); if (tk)await sendExpoPush(tk, title, body, {
          type
        });
      }
    },
      [showBanner]);

    // ─── Persist session ─────────────────────
    useEffect(()=> {
      if (state.session && state.profile) saveSession(state.session, state.profile, state.role, state.lang);
    },
      [state.session,
        state.profile,
        state.role,
        state.lang]);

    // ─── Persist activeTrip to storage whenever it changes ───────────────
    useEffect(() => {
      saveActiveTrip(state.activeTrip);
      // Reset sheet to expanded whenever a new trip starts
      tripSheetAnim.setValue(0);
      tripSheetIsMin.current = false;
    }, [state.activeTrip]);

    // ─── Load favorites from storage ─────────────────────────────────────
    useEffect(() => {
      if (!state.session) return;
      loadFavorites().then(favs => dispatch({ type: 'SET_FAVORITES', p: favs }));
    }, [state.session]);

    // ─── Show TOS only immediately after a fresh signup ──────────────────
    useEffect(() => {
      if (state.step !== 'app') return;
      if (!justSignedUpRef.current) return; // existing users (sign-in) never see this
      AsyncStorage.getItem('@motolink_tos_accepted').then(val => {
        justSignedUpRef.current = false; // consume the flag — only fires once
        if (!val) {
          setShowTOS(true); // mandatory ID-scan chain runs after "Agree" is tapped, see TOS accept handler
        } else if (state.role === 'driver' && !state.profile?.id_submitted) {
          // TOS was already accepted previously on this device — go straight to the
          // mandatory document scan so new drivers can't skip it just because of that.
          setIdScanMandatory(true);
          setIdScanModal(true);
        }
      }).catch(() => {
        justSignedUpRef.current = false;
      });
    }, [state.step]);

    // ─── Poll for active trip every 6s (safety net for web realtime gaps) ─
    useEffect(() => {
      if (!state.session) return;
      const uid = state.session.user.id;
      const role = state.role;
      const poll = async () => {
        try {
          const activeStatuses = ['searching', 'accepted', 'completion_requested', 'awaiting_driver_confirm', 'picked_up'];
          let q = supabase.from('trips').select('*').in('status', activeStatuses).order('created_at', { ascending: false }).limit(1);
          if (role === 'passenger') q = q.eq('passenger_id', uid);
          else q = q.eq('driver_id', uid);
          const { data } = await q;
          const fetched = data?.[0] || null;
          const current = state.activeTrip;
          if (fetched) {
            // Always update if no current AT, or if anything changed
            if (!current || current.id !== fetched.id || current.status !== fetched.status
              || current.payment_status !== fetched.payment_status) {
              dispatch({ type: 'SET_ACTIVE_TRIP', p: fetched });
            }
          } else if (current && !['cancelled', 'completed'].includes(current.status)) {
            // Verify trip is truly gone before clearing
            const { data: check } = await supabase.from('trips').select('status').eq('id', current.id).single();
            if (check && ['cancelled', 'completed'].includes(check.status)) {
              dispatch({ type: 'SET_ACTIVE_TRIP', p: null });
            }
          }
        } catch {}
      };
      poll();
      const interval = setInterval(poll, 6000);
      return () => clearInterval(interval);
    }, [state.session, state.role]);

    // ─── Driver: stream GPS via Supabase Realtime WebSocket during active mission ───
    // Uses dedicated channel per trip (ride_session_{id}) + distance filter (>5m)
    // to prevent rubber-banding and battery drain at traffic lights
    useEffect(() => {
      if (state.role !== 'driver') return;
      if (!state.activeTrip?.id) return;
      if (!['accepted', 'picked_up'].includes(state.activeTrip.status)) return;
      if (!state.session) return;

      const tripId = state.activeTrip.id;
      const driverId = state.session.user.id;
      let lastLat = null;
      let lastLng = null;
      const MIN_DISTANCE_M = 5; // only broadcast if moved >5 metres

      // Haversine distance check (fast client-side, metres)
      const metreBetween = (la1, lo1, la2, lo2) => {
        const R = 6371000;
        const dLat = (la2 - la1) * Math.PI / 180;
        const dLon = (lo2 - lo1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      };

      // Open a dedicated Supabase Realtime broadcast channel for this trip
      const channel = supabase.channel(`ride_session_${tripId}`, {
        config: { broadcast: { self: false } }
      });
      channel.subscribe();

      const broadcastLocation = async () => {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const { latitude: lat, longitude: lng } = loc.coords;

          // Distance filter — skip if barely moved
          if (lastLat !== null) {
            const dist = metreBetween(lastLat, lastLng, lat, lng);
            if (dist < MIN_DISTANCE_M) return;
          }
          lastLat = lat; lastLng = lng;

          // 1. Broadcast over WebSocket channel (passenger gets it in <100ms)
          channel.send({
            type: 'broadcast',
            event: 'location_update',
            payload: { lat, lng, ts: Date.now() },
          });

          // 2. Also persist to profiles table for cold-start / reconnect
          await supabase.from('profiles').update({
            current_lat: lat,
            current_lng: lng,
          }).eq('id', driverId);
        } catch {}
      };

      broadcastLocation(); // immediate first push
      const interval = setInterval(broadcastLocation, 3000); // 3s — tighter than before
      return () => {
        clearInterval(interval);
        supabase.removeChannel(channel);
      };
    }, [state.role, state.activeTrip?.id, state.activeTrip?.status, state.session]);

    // ─── Passenger: subscribe to driver WebSocket channel during active trip ───
    useEffect(() => {
      if (state.role !== 'passenger') return;
      if (!state.activeTrip?.id) return;
      if (!['accepted', 'picked_up'].includes(state.activeTrip?.status)) return;

      const channel = supabase.channel(`ride_session_${state.activeTrip.id}`, {
        config: { broadcast: { self: false } }
      });
      channel
        .on('broadcast', { event: 'location_update' }, ({ payload }) => {
          if (payload?.lat && payload?.lng) {
            setTargetLocation({ latitude: payload.lat, longitude: payload.lng });
          }
        })
        .on('broadcast', { event: 'sos_alert' }, ({ payload }) => {
          // Tracker or other emergency contact sent SOS — alert passenger/driver immediately
          const sender = payload?.name || 'A tracker';
          const msg    = payload?.message || 'Emergency reported from your live trip link.';
          const phone  = payload?.phone || '';
          showBanner(
            '🚨 SOS ALERT from ' + sender,
            msg + (phone ? `\nCall back: ${phone}` : ''),
            'error'
          );
          // Also fire a local OS notification (audible even if app is backgrounded)
          Notifications.scheduleNotificationAsync({
            content: {
              title: '🚨 EMERGENCY SOS — ' + sender,
              body: msg,
              sound: true,
              data: { type: 'sos', tripId: state.activeTrip.id },
            }, trigger: null,
          }).catch(() => {});
        })
        .subscribe();

      return () => supabase.removeChannel(channel);
    }, [state.role, state.activeTrip?.id, state.activeTrip?.status]);

    // ─── AI Tooltip pop-up logic ─────────────────────────────────────────
    // Messages per language — rotated each appearance
    const AI_TOOLTIP_MESSAGES = {
      en: state.role === 'driver' ? [
        "Hey! 🏍️ I'm MotoLink AI — maximize your earnings today!",
        "Tap me to check peak hours & surge zones 📍",
        "Need help with MoMo payouts or leaderboard? Ask me! 🏆",
        "I can accept rides, check your rank & more! 🚀",
        "Got a question about a trip or payment? I've got you! 💬",
      ] : [
        "Hey! 🏍️ I'm MotoLink AI — got a question? Tap me!",
        "Need help booking a ride? I've got you! 💬",
        "Ask me about fares, MoMo, or trip tracking 🗺️",
        "Got a question? I speak English, Français & Kinyarwanda! 🌍",
        "Stuck? Tap me for instant help with MotoLink 🚀",
      ],
      rw: state.role === 'driver' ? [
        "Muraho! 🏍️ Ndi MotoLink AI — ngufashe kwiyongera inyungu!",
        "Kanda hano urebe amasaa y'isoko & ahantu hari umusaruro 📍",
        "Ufite ikibazo kuri MoMo cyangwa urutonde? Baza! 🏆",
        "Nshobora gukora byinshi: kureba amanota, inyungu & ibindi! 🚀",
        "Ufite ikibazo k'urugendo cyangwa ubwishyu? Nkubwire! 💬",
      ] : [
        "Muraho! 🏍️ Ndi MotoLink AI — ufite ikibazo? Kanda hano!",
        "Ukeneye gufata inzira? Nkubwire! 💬",
        "Baza ibijyanye n'ibiciro, MoMo, cyangwa urugendo 🗺️",
        "Nshobora kugufasha mu Kinyarwanda, English & Français! 🌍",
        "Hari ikibazo? Kanda hano ubone ubufasha 🚀",
      ],
      fr: state.role === 'driver' ? [
        "Salut! 🏍️ Je suis MotoLink IA — maximisez vos gains!",
        "Vérifiez les heures de pointe & zones actives 📍",
        "Besoin d'aide avec MoMo ou le classement? Demandez! 🏆",
        "Je peux vous aider avec vos trajets, paiements & plus! 🚀",
        "Une question sur un trajet ou paiement? Je suis là! 💬",
      ] : [
        "Salut! 🏍️ Je suis MotoLink IA — une question? Appuyez!",
        "Besoin d'aide pour réserver? Je suis là! 💬",
        "Posez-moi des questions sur les tarifs, MoMo ou le suivi 🗺️",
        "Je parle Français, English & Kinyarwanda! 🌍",
        "Coincé? Appuyez ici pour une aide instantanée 🚀",
      ],
    };

    const showAiTooltip = useCallback(() => {
      // Don't pop up if AI chat is already open
      if (showAIChat) return;
      const msgs = AI_TOOLTIP_MESSAGES[state.lang] || AI_TOOLTIP_MESSAGES.en;
      aiTooltipMsgIdx.current = (aiTooltipMsgIdx.current + 1) % msgs.length;
      setAiTooltipVisible(true);
      // Animate in: fade + scale bubble
      aiTooltipAnim.setValue(0);
      aiTooltipScaleX.setValue(0.6);
      Animated.parallel([
        Animated.spring(aiTooltipAnim, {
          toValue: 1, friction: 7, tension: 100, useNativeDriver: true,
        }),
        Animated.spring(aiTooltipScaleX, {
          toValue: 1, friction: 6, tension: 90, useNativeDriver: true,
        }),
      ]).start();
      // Auto-hide after 4.5 seconds
      if (aiTooltipHideTimer.current) clearTimeout(aiTooltipHideTimer.current);
      aiTooltipHideTimer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(aiTooltipAnim, {
            toValue: 0, duration: 280, useNativeDriver: true,
          }),
          Animated.timing(aiTooltipScaleX, {
            toValue: 0.7, duration: 260, useNativeDriver: true,
          }),
        ]).start(() => setAiTooltipVisible(false));
      }, 4500);
    },
      [showAIChat,
        state.lang]);

    // Schedule interval: first pop at 6s, then every 40s
    useEffect(() => {
      if (!state.session) return; // Only show when logged in
      const firstTimer = setTimeout(() => {
        showAiTooltip();
        aiTooltipTimer.current = setInterval(showAiTooltip, 40000);
      }, 6000);
      return () => {
        clearTimeout(firstTimer);
        if (aiTooltipTimer.current) clearInterval(aiTooltipTimer.current);
        if (aiTooltipHideTimer.current) clearTimeout(aiTooltipHideTimer.current);
      };
    },
      [state.session,
        state.lang]);

    // ─── Restore session on mount ────────────
    useEffect(() => {
      const timeout = setTimeout(() => {
        dispatch( {
          type: 'SET_HYDRATED'
        });
        dispatch( {
          type: 'SET_STEP', p: 'lang'
        });
      }, 5000);

      (async () => {
        try {
          const saved = await loadSession();
          if (saved?.session && saved?.profile) {
            const {
              data: fp,
              error
            } = await supabase
            .from('profiles').select('*').eq('id', saved.session.user.id).single();
            if (fp && !error) {
              dispatch( {
                type: 'SET_SESSION', p: {
                  session: saved.session, profile: fp
                }
              });
              dispatch( {
                type: 'SET_ROLE', p: saved.role || fp.role
              });
              if (saved.lang) dispatch( {
                type: 'SET_LANG', p: saved.lang
              });
              dispatch( {
                type: 'SET_HYDRATED'
              });

              // ── RESTORE ACTIVE TRIP IMMEDIATELY from local cache ────────
              const cachedTrip = await loadActiveTrip();
              if (cachedTrip && !['cancelled', 'completed'].includes(cachedTrip.status)) {
                dispatch({ type: 'SET_ACTIVE_TRIP', p: cachedTrip });
              }

              // ── RESTORE ACTIVE TRIP ─────────────────
              // Re-fetch any in-progress trip so user lands on active mission screen
              const role = saved.role || fp.role;
              const uid = saved.session.user.id;
              const activeStatuses = ['searching',
                'accepted',
                'completion_requested',
                'awaiting_driver_confirm'];
              let tripQuery = supabase.from('trips').select('*').in('status', activeStatuses).order('created_at', {
                ascending: false
              }).limit(1);
              if (role === 'passenger') tripQuery = tripQuery.eq('passenger_id', uid);
              else tripQuery = tripQuery.eq('driver_id', uid);
              const {
                data: activeTrips
              } = await tripQuery;
              if (activeTrips && activeTrips.length > 0) {
                const activeTrip = activeTrips[0];
                dispatch( {
                  type: 'SET_ACTIVE_TRIP', p: activeTrip
                });
                // Restore target location on map
                if (role === 'passenger' && activeTrip.status === 'accepted' && activeTrip.driver_id) {
                  const {
                    data: drv
                  } = await supabase.from('profiles')
                  .select('current_lat,current_lng').eq('id', activeTrip.driver_id).single();
                  if (drv?.current_lat) setTargetLocation({
                    latitude: drv.current_lat, longitude: drv.current_lng
                  });
                }
                if (role === 'driver' && activeTrip.pickup_lat) {
                  setTargetLocation({
                    latitude: activeTrip.pickup_lat, longitude: activeTrip.pickup_lng
                  });
                }
              }
            } else {
              await clearSession();
              dispatch( {
                type: 'SET_HYDRATED'
              });
              dispatch( {
                type: 'SET_STEP', p: 'lang'
              });
            }
          } else {
            dispatch( {
              type: 'SET_HYDRATED'
            });
            dispatch( {
              type: 'SET_STEP', p: 'splash'
            });
          }
        } catch (e) {
          console.warn('Session restore error:', e);
          await clearSession();
          dispatch( {
            type: 'SET_HYDRATED'
          });
          dispatch( {
            type: 'SET_STEP', p: 'lang'
          });
        } finally {
          clearTimeout(timeout);
        }
      })();
    }, []);

    // ─── App foreground refresh ──────────────
    useEffect(()=> {
      if (Platform.OS === 'web') return;
      const sub = AppState.addEventListener('change',
        async next => {
          if (appStateRef.current.match(/inactive|background/) && next === 'active' && state.session) {
            syncData();
            // If passenger returns and has an active accepted trip, show immediate notice
            if (state.role === 'passenger' && state.activeTrip &&
                ['accepted', 'picked_up'].includes(state.activeTrip.status)) {
              showBanner(
                '🏍️ ' + (state.activeTrip.status === 'accepted' ? 'Driver On the Way' : 'Ride Active'),
                `${state.activeTrip.driver_name || 'Driver'} · ${state.activeTrip.pickup_address}`,
                'accepted'
              );
              setSuggestions([]);
              Keyboard.dismiss();
            }
          }
          appStateRef.current = next;
        });
      return ()=>sub.remove();
    }, [state.session, state.role, state.activeTrip]);

    // ─── Hardware back — UPGRADE: minimize/navigate, never exit ────────────────
    useEffect(() => {
      const onBack = () => {
        // Close modals/panels in priority order — never quit the app
        if (historyModal) {
          setHistoryModal(false); return true;
        }
        if (sosModal) {
          setSosModal(false); return true;
        }
        if (paymentModal) {
          return true;
        } // payment in progress — block back
        if (ratingModal) {
          return true;
        } // rating in progress — block back
        if (paySetupModal) {
          setPaySetupModal(false); return true;
        }
        if (profileModal) {
          setProfileModal(false); return true;
        }
        if (showLeaderboard) {
          setShowLeaderboard(false); return true;
        }
        if (state.menuOpen) {
          dispatch( {
            type: 'TOGGLE_MENU'
          }); return true;
        }
        if (suggestions.length > 0) {
          setSuggestions([]); return true;
        }
        if (destCoords && !state.activeTrip) {
          setDestCoords(null); setTargetLocation(null); return true;
        }
        // ── UPGRADE: On root screen, minimize to background instead of exit ──
        // This sends the app to background (recent apps) without killing it
        if (Platform.OS === 'android') {
          // Move task to back — app stays in recents, doesn't exit
          const {
            NativeModules
          } = require('react-native');
          if (NativeModules?.AndroidModule?.moveTaskToBack) {
            NativeModules.AndroidModule.moveTaskToBack(true);
          } else {
            // Fallback: use BackHandler.exitApp only after 2-tap confirmation
            // For now, just return true to block exit without UI
          }
          return true; // Always intercept — never let the OS kill the app
        }
        return true; // iOS: swipe-to-close is already handled by the OS
      };
      if (Platform.OS === 'web') return;
      const h = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => h.remove();
    },
      [
        sosModal,
        paymentModal,
        ratingModal,
        paySetupModal,
        profileModal,
        state.menuOpen,
        suggestions,
        destCoords,
        state.activeTrip,
        historyModal,
        showLeaderboard,
      ]);

    // ─── Auto reverse-geocode current location for "From" field ─────────
    useEffect(() => {
      if (!state.myLocation || destCoords) return;
      const {
        latitude,
        longitude
      } = state.myLocation;
      reverseGeocode(latitude, longitude).then(addr => {
        if (addr) setPickupAddress(addr);
      }).catch(() => {});
    }, [state.myLocation?.latitude, state.myLocation?.longitude]);

    // ─── Surge pricing monitor ───────────────
    useEffect(() => {
      if (state.step !== 'app') return;
      const checkSurge = async () => {
        const multiplier = await getSurgeMultiplier();
        setSurgeMultiplier(multiplier);
        setSurgeActive(multiplier > 1.0);
      };
      checkSurge();
      const interval = setInterval(checkSurge, 5 * 60 * 1000);
      return () => clearInterval(interval);
    },
      [state.step]);

    // ─── Offline / online monitor ────────────
    useEffect(() => {
      let wasOffline = false;
      const checkNet = async () => {
        try {
          const net = Network ? await Network.getNetworkStateAsync(): {
            isConnected: true,
            isInternetReachable: true
          };
          const online = !!(net.isConnected && net.isInternetReachable);
          const prevOnline = isOnline;
          setIsOnline(online);
          // Went offline
          if (!online && prevOnline !== false) {
            wasOffline = true;
            showBanner(t.offlineMode, t.notif_noInternet, 'offline');
          }
          // Came back online
          if (online && wasOffline) {
            wasOffline = false;
            if (offlineQueue.length > 0) {
              for (const req of offlineQueue) {
                await supabase.from('trips').insert([req]);
              }
              setOfflineQueue([]);
              await AsyncStorage.removeItem(OFFLINE_TRIPS_KEY);
            }
            showBanner('🌐 MotoLink', t.notif_backOnline, 'online');
          }
        } catch {
          setIsOnline(true);
        }
      };
      checkNet();
      const interval = setInterval(checkNet, 10000);
      return () => clearInterval(interval);
    },
      [offlineQueue,
        t]);

    // ─── Restore offline queue from storage ──
    useEffect(() => {
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(OFFLINE_TRIPS_KEY);
          if (raw) setOfflineQueue(JSON.parse(raw));
        } catch {}
      })();
    }, []);

    // ── UPGRADE: Scheduled trip countdown — 60/45/30/15 min intervals, both sides ──
    useEffect(() => {
      if (state.step !== 'app' || !state.session) return;
      const REMIND_INTERVALS = [60,
        45,
        30,
        15]; // minutes before trip

      const checkScheduledReminders = async () => {
        const now = new Date();
        const uid = state.session.user.id;

        for (const minsBefore of REMIND_INTERVALS) {
          const windowStart = new Date(now.getTime() + (minsBefore - 1) * 60 * 1000);
          const windowEnd = new Date(now.getTime() + (minsBefore + 1) * 60 * 1000);

          if (state.role === 'driver') {
            // Driver: trips pre-accepted by this driver
            const {
              data: preAccepted
            } = await supabase.from('trips')
            .select('*')
            .eq('pre_accepted_by', uid)
            .eq('is_scheduled', true)
            .in('status', ['scheduled', 'accepted'])
            .gte('scheduled_for', windowStart.toISOString())
            .lte('scheduled_for', windowEnd.toISOString());

            for (const trip of (preAccepted || [])) {
              const storageKey = `sched_notif_driver_${trip.id}_${minsBefore}`;
              const alreadySent = await AsyncStorage.getItem(storageKey).catch(() => null);
              if (alreadySent) continue;

              const timeLabel = minsBefore >= 60 ? '1 hour': `${minsBefore} min`;
              notify(
                t.scheduledReminder || '⏰ Scheduled Trip',
                `${t.scheduledReminderDriver || 'Your pre-accepted trip starts in'} ${timeLabel}: ${trip.pickup_address} → ${trip.destination_address}`,
                'ride'
              );
              // Also fire local OS notification (works when app is backgrounded)
              Notifications.scheduleNotificationAsync({
                content: {
                  title: t.scheduledReminder || '⏰ Scheduled Trip',
                  body: `${timeLabel}: ${trip.pickup_address} → ${trip.destination_address}`,
                  sound: true,
                  data: {
                    tripId: trip.id, type: 'scheduled_reminder'
                  },
                },
                trigger: null,
              }).catch(() => {});
              await AsyncStorage.setItem(storageKey, '1').catch(() => {});
            }

            // Also scan nearby unaccepted scheduled trips for driver
            if (minsBefore === 15) {
              const soon = new Date(Date.now() + SCHEDULED_NOTIFY_MIN * 60 * 1000).toISOString();
              const nowIso = new Date().toISOString();
              const {
                data: scheduled
              } = await supabase.from('trips')
              .select('*').eq('status', 'scheduled').is('pre_accepted_by', null)
              .gte('scheduled_for', nowIso).lte('scheduled_for', soon);
              for (const trip of (scheduled || [])) {
                notify(
                  `📅 ${t.scheduledTrip}`,
                  `${trip.passenger_name}: ${trip.pickup_address} → ${trip.destination_address} — in ${SCHEDULED_NOTIFY_MIN} min`,
                  'ride'
                );
              }
            }
          } else if (state.role === 'passenger') {
            // Passenger: their own scheduled trips
            const {
              data: myScheduled
            } = await supabase.from('trips')
            .select('*')
            .eq('passenger_id', uid)
            .eq('is_scheduled', true)
            .in('status', ['scheduled', 'accepted'])
            .gte('scheduled_for', windowStart.toISOString())
            .lte('scheduled_for', windowEnd.toISOString());

            for (const trip of (myScheduled || [])) {
              const storageKey = `sched_notif_pax_${trip.id}_${minsBefore}`;
              const alreadySent = await AsyncStorage.getItem(storageKey).catch(() => null);
              if (alreadySent) continue;

              const timeLabel = minsBefore >= 60 ? '1 hour': `${minsBefore} min`;
              const driverInfo = trip.pre_accepted_by ? ` — Driver: ${trip.driver_name || 'Reserved'}`: ' — Searching for driver';
              notify(
                t.scheduledReminder || '⏰ Scheduled Trip',
                `${t.scheduledReminderBody || 'Your trip starts in'} ${timeLabel}: ${trip.pickup_address} → ${trip.destination_address}${driverInfo}`,
                'ride'
              );
              Notifications.scheduleNotificationAsync({
                content: {
                  title: t.scheduledReminder || '⏰ Scheduled Trip',
                  body: `${timeLabel}: ${trip.destination_address}${driverInfo}`,
                  sound: true,
                  data: {
                    tripId: trip.id, type: 'scheduled_reminder'
                  },
                },
                trigger: null,
              }).catch(() => {});
              await AsyncStorage.setItem(storageKey, '1').catch(() => {});
            }
          }
        }
      };

      checkScheduledReminders();
      const interval = setInterval(checkScheduledReminders, 60 * 1000); // check every minute
      return () => clearInterval(interval);
    },
      [state.step,
        state.role,
        state.session,
        t]);

    // ─── Scheduled trip auto-cancel — expire trips whose time has passed ──
    // Runs every 60 s. Cancels any scheduled trip where scheduled_for < now
    // AND it's still in status 'scheduled' or 'searching' (no driver accepted yet).
    // Also clears the local activeTrip state if the passenger is viewing it.
    useEffect(() => {
      if (!state.session) return;
      const uid = state.session.user.id;

      const expireScheduled = async () => {
        const now = new Date().toISOString();
        try {
          // Fetch stale scheduled trips belonging to this user (either role)
          const col = state.role === 'passenger' ? 'passenger_id': 'driver_id';
          const {
            data: stale
          } = await supabase
          .from('trips')
          .select('id, passenger_id, driver_id, pickup_address, destination_address')
          .eq('is_scheduled', true)
          .in('status', ['scheduled', 'searching'])
          .lt('scheduled_for', now)
          .eq(col, uid);

          if (!stale || stale.length === 0) return;

          for (const trip of stale) {
            // Mark cancelled in DB
            await supabase
            .from('trips')
            .update({
              status: 'cancelled', cancelled_at: now
            })
            .eq('id', trip.id);

            // Clear local activeTrip if this is the one the passenger sees
            if (state.activeTrip?.id === trip.id) {
              dispatch( {
                type: 'CLEAR_ACTIVE_TRIP'
              });
            }

            // Notify passenger
            if (state.role === 'passenger') {
              showBanner(
                '📅 ' + (t.scheduledTrip || 'Scheduled Trip'),
                (t.cancelledAt || 'Expired — no driver assigned in time') +
                `: ${trip.pickup_address} → ${trip.destination_address}`,
                'warning'
              );
            }
          }
        } catch (e) {
          // silent — non-critical background task
        }
      };

      expireScheduled(); // run immediately on mount
      const expireTimer = setInterval(expireScheduled, 60 * 1000);
      return () => clearInterval(expireTimer);
    },
      [state.session,
        state.role]);
    const loadLeaderboard = async () => {
      const {
        data
      } = await supabase.from('driver_leaderboard').select('*');
      if (data) setLeaderboard(data);
    };

    // ─── Check B2B company membership ────────
    useEffect(() => {
      if (!state.session || !state.profile?.company_id) return;
      (async () => {
        const {
          data
        } = await supabase.from('companies')
        .select('*').eq('id', state.profile.company_id).single();
        if (data) setCompanyData(data);
      })();
    }, [state.session, state.profile?.company_id]);

    // ─── Cache history offline ────────────────
    useEffect(() => {
      if (!state.session || state.step !== 'app') return;
      (async () => {
        const {
          data
        } = await supabase.from('trips').select('*')
        .in('status', ['completed', 'cancelled'])
        .eq(state.role === 'passenger'?'passenger_id': 'driver_id', state.session.user.id)
        .order('created_at', {
          ascending: false
        }).limit(20);
        if (data) await AsyncStorage.setItem(OFFLINE_HISTORY_KEY, JSON.stringify(data));
      })();
    }, [state.step, state.session]);

    // ─── Notification channel ────────────────
    useEffect(()=> {
      if (IS_EXPO_GO) return; // Not supported in Expo Go (SDK 53+)
      if (Platform.OS === 'android') {
        Notifications.setNotificationChannelAsync('motolink-default', {
          name: 'MotoLink', importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 300, 150, 300], lightColor: C.gold, sound: 'default', showBadge: true,
        });
      }
    },
      []);

    // ─── Push token registration ─────────────
    useEffect(()=> {
      if (!state.session || IS_EXPO_GO) return; // Push tokens not available in Expo Go
      (async()=> {
        const token = await registerForPush();
        if (token && state.session?.user?.id) await supabase.from('profiles').update({
          push_token: token
        }).eq('id', state.session.user.id);
      })();
    }, [state.session]);

    // ─── Menu animation ──────────────────────
    useEffect(()=> {
      Animated.timing(menuAnim,
        {
          toValue: state.menuOpen?0: -900,
          duration: 380,
          useNativeDriver: true
        }).start();
    }, [state.menuOpen]);

    // ══════════════════════════════════════════
    // AUTH
    // ══════════════════════════════════════════
    const normalisePhone = (r)=>r.replace(/\s+/g, '').trim();

    const handleSignIn = async () => {
      if (!phone) return showBanner('MotoLink', t.notif_noPhone, 'warning');
      if (!password) return showBanner('MotoLink', t.notif_noPass, 'warning');
      if (!isOnline) return showBanner(t.offlineMode, t.notif_noInternet, 'offline');
      setAuthLoading(true);
      const np = normalisePhone(phone);
      const {
        data,
        error
      } = await supabase
      .from('profiles').select('*').eq('phone', np).eq('password', password).single();
      setAuthLoading(false);
      if (error || !data) {
        showBanner(t.signIn, t.notif_wrongCreds, 'error');
      } else {
        dispatch( {
          type: 'SET_SESSION', p: {
            session: {
              user: {
                id: data.id, phone: np
              }
            }, profile: data
          }
        });
        dispatch( {
          type: 'SET_ROLE', p: data.role
        });
        showBanner('MotoLink 🛵', `${t.welcome}, ${data.name}!`, 'success');

        // ── Restore any active trip immediately after sign-in ──
        // (Mirrors the cold-start restoration so re-logging in doesn't lose
        //  an in-progress ride — passenger sees Finding/Active screen again,
        //  driver sees their current mission again.)
        try {
          const activeStatuses = ['searching', 'accepted', 'completion_requested', 'awaiting_driver_confirm', 'picked_up'];
          let tripQuery = supabase.from('trips').select('*').in('status', activeStatuses)
            .order('created_at', { ascending: false }).limit(1);
          tripQuery = data.role === 'passenger'
            ? tripQuery.eq('passenger_id', data.id)
            : tripQuery.eq('driver_id', data.id);
          const { data: activeTrips } = await tripQuery;
          if (activeTrips && activeTrips.length > 0) {
            const activeTrip = activeTrips[0];
            dispatch({ type: 'SET_ACTIVE_TRIP', p: activeTrip });
            saveActiveTrip(activeTrip).catch(() => {});

            // Restore map target so the trip screen shows the right pin
            if (data.role === 'passenger' && activeTrip.status === 'accepted' && activeTrip.driver_id) {
              const { data: drv } = await supabase.from('profiles')
                .select('current_lat,current_lng').eq('id', activeTrip.driver_id).single();
              if (drv?.current_lat) setTargetLocation({ latitude: drv.current_lat, longitude: drv.current_lng });
            } else if (data.role === 'passenger' && activeTrip.status === 'searching') {
              setTargetLocation({ latitude: activeTrip.destination_lat, longitude: activeTrip.destination_lng });
            } else if (data.role === 'driver' && activeTrip.pickup_lat) {
              setTargetLocation({ latitude: activeTrip.pickup_lat, longitude: activeTrip.pickup_lng });
            }

            showBanner(
              activeTrip.status === 'searching' ? '🔍 ' + (t.findingDriver || 'Finding Driver...') : '🛵 ' + (t.activeTripFound || 'Active trip restored'),
              `${activeTrip.pickup_address} → ${activeTrip.destination_address}`,
              'ride'
            );
          }
        } catch (e) {
          console.warn('Active trip restore on sign-in failed:', e);
        }
      }
    };

    const handleSignUp = async () => {
      if (!phone || !password || !nameVal || !confirmPass)
        return showBanner('MotoLink', t.notif_allFields, 'warning');
      if (password.length < 6)
        return showBanner('MotoLink', t.notif_passShort, 'warning');
      if (password !== confirmPass)
        return showBanner('MotoLink', t.notif_passMismatch2, 'warning');
      if (!isOnline)
        return showBanner(t.offlineMode, t.notif_noInternet, 'offline');
      setAuthLoading(true);
      const np = normalisePhone(phone);
      const {
        data: ex
      } = await supabase.from('profiles').select('id').eq('phone', np).single();
      if (ex) {
        setAuthLoading(false);
        return showBanner('MotoLink', t.notif_phoneExists, 'warning');
      }

      // Generate unique referral code
      let refCode = genReferralCode();
      // Ensure uniqueness (retry if collision)
      let attempts = 0;
      while (attempts < 5) {
        const {
          data: existing
        } = await supabase.from('profiles').select('id').eq('referral_code', refCode).single();
        if (!existing) break;
        refCode = genReferralCode();
        attempts++;
      }

      // Check if signup came from a referral code (stored in state)
      const usedRefCode = refCodeInput?.trim().toUpperCase() || null;
      let referredById = null;
      if (usedRefCode) {
        const {
          data: referrer
        } = await supabase.from('profiles').select('id').eq('referral_code', usedRefCode).single();
        if (referrer) referredById = referrer.id;
      }

      const newId = uuid();
      const np2 = {
        id: newId,
        phone: np,
        password,
        name: nameVal,
        role: state.role,
        avatar: null,
        plate: '',
        rating: 5.0,
        total_ratings: 0,
        wallet_balance: 0,
        referral_code: refCode,
        referred_by: referredById,
        referral_earnings: 0,
      };
      const {
        error
      } = await supabase.from('profiles').insert([np2]);
      setAuthLoading(false);
      if (error) {
        showBanner(t.signUp, error.message, 'error');
      } else {
        // Credit referrer bonus
        if (referredById) {
          const {
            data: referrer
          } = await supabase.from('profiles')
          .select('wallet_balance, referral_earnings').eq('id', referredById).single();
          if (referrer) {
            const newBal = (referrer.wallet_balance || 0) + 200;
            const newRef = (referrer.referral_earnings || 0) + 200;
            await supabase.from('profiles').update({
              wallet_balance: newBal, referral_earnings: newRef
            }).eq('id', referredById);
            await supabase.from('transactions').insert([{
              user_id: referredById, type: 'referral', amount: 200,
              balance_after: newBal, description: `Referral bonus — ${nameVal} signed up`,
              status: 'completed', method: 'referral',
            }]);
            const tk = await getPushToken(referredById);
            if (tk) await sendExpoPush(tk, '💰 Referral Bonus!', `${nameVal} used your code. 200 FRW added.`, {
              type: 'wallet'
            });
          }
        }
        showBanner('MotoLink 🛵', t.notif_signupOk + ` 🎁 ${refCode}`, 'success');
        justSignedUpRef.current = true;
        dispatch( {
          type: 'SET_SESSION', p: {
            session: {
              user: {
                id: newId, phone: np
              }
            }, profile: np2
          }
        });
        dispatch( {
          type: 'SET_ROLE', p: state.role
        });
      }
    };

    const handleAuth = ()=>authMode === 'signin'?handleSignIn(): handleSignUp();

    const handleDeleteAccount = () => {
      setDeleteConfirmVisible(true);
    };

    const executeDeleteAccount = async () => {
      setDeleteConfirmVisible(false);
      if (!state.session?.user?.id) return;
      setRideLoading(true);
      try {
        // 1. Cancel all active trips
        await supabase.from('trips').update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq(state.role === 'passenger' ? 'passenger_id' : 'driver_id', state.session.user.id)
          .in('status', ['searching', 'accepted', 'scheduled']);
        // 2. Delete profile row
        await supabase.from('profiles').delete().eq('id', state.session.user.id);
        // 3. Sign out from auth (Supabase deletes auth user via RLS/trigger or admin)
        await supabase.auth.signOut();
        setRideLoading(false);
        showBanner('🗑️ MotoLink', t.notif_deleteOk, 'success');
        await clearSession();
        setProfileModal(false);
        dispatch({ type: 'LOGOUT' });
      } catch (err) {
        setRideLoading(false);
        showBanner('MotoLink', 'Could not delete account. Try again.', 'error');
      }
    };

    const updateProfile = async()=> {
      setRideLoading(true);
      const {
        error
      } = await supabase.from('profiles').update({
          name: state.profile.name,
          plate: state.profile.plate,
          emergency_name: state.profile.emergency_name || null,
          emergency_phone: state.profile.emergency_phone || null,
        }).eq('id',
        state.session.user.id);
      setRideLoading(false);
      if (!error) {
        setProfileModal(false);
        showBanner('✓ MotoLink', t.notif_profileSaved, 'success');
      }
    };

    const savePaymentInfo = async (payData) => {
      const {
        error
      } = await supabase.from('profiles').update(payData).eq('id', state.session.user.id);
      if (!error) {
        dispatch( {
          type: 'SET_PROFILE', p: {
            ...state.profile, ...payData
          }
        });
        setPaySetupModal(false);
        showBanner('💳 MotoLink', t.notif_paySetupDone, 'success');
      } else {
        showBanner('MotoLink', error.message, 'error');
      }
    };

    // ══════════════════════════════════════════
    // SOS ENGINE
    // ══════════════════════════════════════════
    // PROMO CODE ENGINE
    // ══════════════════════════════════════════
    const applyPromoCode = async (baseFare) => {
      const code = promoCode.trim().toUpperCase();
      if (!code) return;
      setPromoLoading(true);

      // Check if promo exists and is active
      const {
        data: promo,
        error
      } = await supabase.from('promo_codes')
      .select('*').eq('code', code).eq('active', true).single();

      if (error || !promo) {
        setPromoLoading(false);
        showBanner('❌ MotoLink', t.notif_promoInvalid, 'error');
        return;
      }

      // Check expiry
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        setPromoLoading(false);
        showBanner('❌ MotoLink', t.notif_promoInvalid, 'error');
        return;
      }

      // Check max uses
      if (promo.used_count >= promo.max_uses) {
        setPromoLoading(false);
        showBanner('❌ MotoLink', t.notif_promoInvalid, 'error');
        return;
      }

      // Check if this user already used this code
      const {
        data: used
      } = await supabase.from('promo_usage')
      .select('id').eq('code', code).eq('user_id', state.session.user.id).single();
      if (used) {
        setPromoLoading(false);
        showBanner('⚠️ MotoLink', t.notif_promoUsed, 'warning');
        return;
      }

      // Calculate discount
      let discount = 0;
      if (promo.type === 'flat') discount = Math.min(promo.value, baseFare);
      if (promo.type === 'percent') discount = Math.round(baseFare * (promo.value / 100));

      setPromoLoading(false);
      setPromoData({
        code, type: promo.type, value: promo.value, discount, promoId: promo.id
      });
      showBanner(t.promoApplied, `${fmtFRW(discount)} ${t.promoSaved}`, 'wallet');
    };

    const clearPromo = () => {
      setPromoData(null); setPromoCode('');
    };

    // ══════════════════════════════════════════
    const triggerSOS = async () => {
      setSosModal(false);
      // Show the SOS banner IMMEDIATELY so user knows it fired
      showBanner(t.notif_sosTitle, t.notif_sosSent, 'sos');

      const loc = state.myLocation;
      const profile = state.profile;
      const trip = state.activeTrip;
      const name = profile?.name || 'Unknown';
      const phone = state.session?.user?.phone || '';
      const role = state.role;
      const lat = loc?.latitude || 0;
      const lng = loc?.longitude || 0;
      const hasGPS = lat !== 0 && lng !== 0;
      const mapsUrl = hasGPS ? `https://maps.google.com/?q=${lat},${lng}`: '(location unavailable)';
      const tripInfo = trip ? `\nTrip ID: ${trip.id}\nDriver: ${trip.driver_name || '—'}\nPassenger: ${trip.passenger_name || '—'}`: '';

      // 1. Log SOS to Supabase (non-blocking)
      supabase.from('sos_logs').insert([{
        user_id: state.session?.user?.id,
        user_name: name,
        user_phone: phone,
        user_role: role,
        latitude: lat,
        longitude: lng,
        trip_id: trip?.id || null,
      }]).then(() => {}).catch(() => {});

      // 1b. Broadcast SOS on the trip's live channel so the driver/passenger
      //     AND anyone on the tracking page sees it immediately
      if (trip?.id) {
        const tripCh = supabase.channel(`ride:${trip.id}`);
        tripCh.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            tripCh.send({
              type: 'broadcast',
              event: 'sos_alert',
              payload: { name, phone, role, lat, lng, message: 'Emergency SOS triggered', trip_id: trip.id },
            }).then(() => supabase.removeChannel(tripCh)).catch(() => supabase.removeChannel(tripCh));
          }
        });
        // Also write to trip_sos table read by tracking page
        supabase.from('trip_sos').insert({
          trip_id: trip.id, sender_name: name, sender_phone: phone,
          message: 'Emergency SOS triggered via app', lat, lng,
          timestamp: new Date().toISOString(),
        }).then(() => {}).catch(() => {});
      }

      // 2. Push admin immediately (non-blocking)
      supabase.from('profiles')
      .select('push_token').eq('role', 'admin').not('push_token', 'is', null)
      .then(({
        data: adminTokens
      }) => {
        for (const a of (adminTokens || [])) {
          if (a.push_token) sendExpoPush(
            a.push_token,
            `🚨 SOS — ${name} (${role})`,
            `📍 ${mapsUrl}${tripInfo}`,
            {
              type: 'sos'
            }
          ).catch(() => {});
        }
      }).catch(() => {});

      const safetyMsg = encodeURIComponent(
        `🚨 *MOTOLINK SOS ALERT*\n\n` +
        `Name: ${name}\nPhone: ${phone}\nRole: ${role}\n` +
        `📍 Location: ${mapsUrl}` + tripInfo +
        `\n\nTime: ${new Date().toLocaleString()}`
      );

      // 3. Try WhatsApp → MotoLink safety number, fallback to SMS
      try {
        await Linking.openURL(`whatsapp://send?phone=${SOS_SAFETY_NUMBER.replace('+', '')}&text=${safetyMsg}`);
      } catch {
        Linking.openURL(`sms:${SOS_SAFETY_NUMBER}?body=${safetyMsg}`).catch(() => {});
      }

      // 4. Emergency contact — CALL FIRST (immediate), then WhatsApp message
      if (profile?.emergency_phone) {
        const cleanPhone = profile.emergency_phone.replace(/[^0-9+]/g, '');
        const emergencyMsg = encodeURIComponent(
          `🚨 *EMERGENCY — ${name} needs help!*\n\n` +
          `${name} has triggered an emergency SOS on MotoLink.\n\n` +
          `📍 Their location: ${mapsUrl}\n` +
          `📞 Their phone: ${phone}\n\n` +
          `Please contact them immediately or call emergency services.`
        );
        // Call emergency contact directly — this is the fastest action
        setTimeout(() => {
          Linking.openURL(`tel:${cleanPhone}`).catch(() => {});
        }, 600);
        // Also send WhatsApp message with location (after call dialog)
        setTimeout(() => {
          Linking.openURL(`whatsapp://send?phone=${cleanPhone.replace('+', '')}&text=${emergencyMsg}`)
          .catch(() => {
            Linking.openURL(`sms:${cleanPhone}?body=${emergencyMsg}`).catch(() => {});
          });
        }, 2000);
      }

      // 5. Call safety number last
      setTimeout(() => {
        Linking.openURL(`tel:${SOS_SAFETY_NUMBER}`).catch(() => {});
      }, profile?.emergency_phone ? 3500: 1200);
    };
    const submitRating = async(stars, review)=> {
      if (!tripToRate||!state.session) return;
      setRatingModal(false);
      const isP = state.role === 'passenger';
      const ruid = isP?tripToRate.driver_id: tripToRate.passenger_id;
      const upd = isP? {
        rated_by_passenger: true,
        passenger_rating: stars,
        passenger_review: review
      }: {
        rated_by_driver: true,
        driver_rating: stars,
        driver_review: review
      };
      await supabase.from('trips').update(upd).eq('id', tripToRate.id);
      if (ruid) {
        const {
          data: rp
        } = await supabase.from('profiles').select('rating,total_ratings').eq('id', ruid).single();
        if (rp) {
          const nt = (rp.total_ratings || 0)+1;
          const nr = parseFloat((((rp.rating || 5.0)*(rp.total_ratings || 0)+stars)/nt).toFixed(2));
          const u = {
            rating: nr,
            total_ratings: nt
          };
          if (!isP && nr < 3.5) u.is_suspended = true;
          await supabase.from('profiles').update(u).eq('id', ruid);
        }
      }
      showBanner('⭐ '+t.submitRating, `${stars}★ — ${t.close}!`, 'rated');
      setTripToRate(null);
    };

    // ══════════════════════════════════════════
    // LOCATION — robust permission + GPS-on guard
    // ══════════════════════════════════════════
    // ══════════════════════════════════════════
    // LOCATION — permission + GPS-on guard + AppState re-check
    // ══════════════════════════════════════════
    useEffect(() => {
      if (state.step !== 'app') return;

      // ── WEB: browser Geolocation API ──────────────────────────────────────
      if (Platform.OS === 'web') {
        if (!navigator?.geolocation) return;
        let shown = false;
        const wid = navigator.geolocation.watchPosition(
          (pos) => {
            const coords = {
              latitude: pos.coords.latitude, longitude: pos.coords.longitude
            };
            dispatch( {
              type: 'SET_LOCATION', p: coords
            });
            myLocRef.current = coords;
            if (!shown) {
              shown = true; showBanner('📍 MotoLink', t.notif_locGranted, 'location');
            }
          },
          (err) => {
            showBanner('📍 GPS', err.code === 1 ? t.notif_locDenied: t.notif_locOff, err.code === 1 ? 'error': 'warning');
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 5000
          }
        );
        return () => navigator.geolocation.clearWatch(wid);
      }

      // ── NATIVE: expo-location ──────────────────────────────────────────────
      let sub = null;
      let gpsOkShown = false;
      let gpsRetryTimer = null;
      let appStateSubscription = null;
      let stopped = false;

      const stopWatcher = () => {
        stopped = true;
        sub?.remove();
        sub = null;
        if (gpsRetryTimer) {
          clearInterval(gpsRetryTimer); gpsRetryTimer = null;
        }
        appStateSubscription?.remove();
      };

      const startWatching = async () => {
        if (stopped) return;
        try {
          // ── 1. Permission ──────────────────────────────
          let {
            status
          } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted') {
            const req = await Location.requestForegroundPermissionsAsync();
            status = req.status;
          }
          if (status !== 'granted') {
            showBanner('📍 MotoLink', t.notif_locDenied, 'error');
            Alert.alert(
              '📍 Location Required',
              t.notif_locDenied || 'MotoLink needs location access. Please enable it in Settings.',
              [{
                text: 'Not Now', style: 'cancel'
              },
                {
                  text: '⚙️ Open Settings',
                  onPress: () => {
                    if (Platform.OS === 'ios') Linking.openURL('app-settings:');
                    else Linking.openSettings ? Linking.openSettings(): Linking.openURL('package:com.gerarddev.motolink');
                  }
                },
              ]
            );
            return;
          }

          // ── 2. GPS hardware switch ─────────────────────
          const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
          if (!enabled) {
            showBanner('📍 GPS', t.notif_locOff, 'warning');
            // Show an Alert with a direct link to Location Settings
            Alert.alert(
              '📍 ' + (t.notif_locOff || 'Location Services Off'),
              Platform.OS === 'android'
                ? 'MotoLink needs GPS to find drivers near you. Please enable Location Services to continue.'
                : 'Please enable Location Services for MotoLink in Settings → Privacy → Location Services.',
              [
                { text: 'Not Now', style: 'cancel' },
                {
                  text: '⚙️ Enable GPS',
                  onPress: () => {
                    if (Platform.OS === 'ios') Linking.openURL('app-settings:');
                    else Linking.openURL('android.settings.LOCATION_SOURCE_SETTINGS').catch(
                      () => Linking.openSettings ? Linking.openSettings() : null
                    );
                  }
                },
              ],
              { cancelable: true }
            );
            // Poll every 3s until GPS turns on
            if (!gpsRetryTimer) {
              gpsRetryTimer = setInterval(async () => {
                if (stopped) { clearInterval(gpsRetryTimer); return; }
                const nowEnabled = await Location.hasServicesEnabledAsync().catch(() => false);
                if (nowEnabled) {
                  clearInterval(gpsRetryTimer);
                  gpsRetryTimer = null;
                  startWatching();
                }
              }, 3000);
            }
            return;
          }

          // ── 3. Stop any existing watcher before starting new ──
          if (sub) {
            sub.remove(); sub = null;
          }

          // ── 4a. Seed location immediately from last known fix (eliminates "Loading..." delay) ──
          try {
            const last = await Location.getLastKnownPositionAsync({
              maxAge: 120000, requiredAccuracy: 200
            });
            if (last && !stopped) {
              const coords = {
                latitude: last.coords.latitude,
                longitude: last.coords.longitude
              };
              dispatch( {
                type: 'SET_LOCATION', p: coords
              });
              myLocRef.current = coords;
            }
          } catch (_) {}

          // ── 4b. Watch position ──────────────────────────
          sub = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High, // High = good accuracy, less battery than BestForNavigation
              distanceInterval: 10, // update every 10 m
              timeInterval: 4000, // at least every 4 s
              mayShowUserSettingsDialog: true, // Android: prompt to enable GPS if off
            },
            async (loc) => {
              if (stopped) return;
              const coords = {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude
              };
              dispatch( {
                type: 'SET_LOCATION', p: coords
              });
              myLocRef.current = coords; // Keep ref fresh for search debounce
              if (!gpsOkShown) {
                gpsOkShown = true;
                showBanner('📍 MotoLink', t.notif_locGranted, 'location');
              }
              // Speed monitoring — warn passenger if driver going >80 km/h
              const speedKmh = (loc.coords.speed || 0) * 3.6;
              speedRef.current = speedKmh;
              // ── UPGRADE: Update DB for drivers; passengers also get location tracked for pickup accuracy ──
              if (state.session) {
                if (state.role === 'driver') {
                  supabase.from('profiles').update({
                    current_lat: coords.latitude,
                    current_lng: coords.longitude,
                  }).eq('id', state.session.user.id).then(() => {});
                } else {
                  // Passengers: update location for better pickup pin accuracy (throttled)
                  supabase.from('profiles').update({
                    current_lat: coords.latitude,
                    current_lng: coords.longitude,
                  }).eq('id', state.session.user.id).then(() => {});
                }
              }
            }
          );
        } catch (err) {
          console.warn('[MotoLink] Location error:',
            err?.message || err);
          showBanner('📍 GPS',
            t.notif_locOff,
            'warning');
        }
      };

      // Re-check GPS every time app comes back from background
      appStateSubscription = AppState.addEventListener('change', async (nextState) => {
        if (nextState === 'active' && !stopped) {
          // Always re-check GPS status on resume — user may have toggled it
          const nowEnabled = await Location.hasServicesEnabledAsync().catch(() => true);
          if (!nowEnabled && !gpsRetryTimer) {
            // GPS is still off — show banner (no Alert popup on resume, just banner)
            showBanner('📍 GPS', t.notif_locOff, 'warning');
            gpsRetryTimer = setInterval(async () => {
              if (stopped) { clearInterval(gpsRetryTimer); gpsRetryTimer = null; return; }
              const on = await Location.hasServicesEnabledAsync().catch(() => false);
              if (on) { clearInterval(gpsRetryTimer); gpsRetryTimer = null; startWatching(); }
            }, 3000);
          } else if (nowEnabled && !sub) {
            // GPS came on and we have no watcher — start fresh
            startWatching();
          }
        }
      });

      startWatching();

      return () => stopWatcher();
    }, [state.step]); // Only depend on step — session/role changes don't need to restart GPS

    // ══════════════════════════════════════════
    // REAL-TIME SYNC
    // ══════════════════════════════════════════
    const syncData = useCallback(async()=> {
      if (!state.session) return;
      const {
        data: p
      } = await supabase.from('profiles').select('wallet_balance').eq('id', state.session.user.id).single();
      if (p) dispatch( {
        type: 'SET_WALLET', p: p.wallet_balance || 0
      });
      if (state.role === 'passenger') {
        const {
          data
        } = await supabase.from('trips').select('*').eq('passenger_id', state.session.user.id).in('status', ['searching', 'accepted', 'completion_requested', 'awaiting_driver_confirm']).order('created_at', {
            ascending: false
          });
        dispatch( {
          type: 'SET_MY_TRIPS', p: data || []});
      } else {
        const {
          data
        } = await supabase.from('trips').select('*').eq('status', 'searching').order('created_at', {
            ascending: false
          });
        dispatch( {
          type: 'SET_AVAILABLE_TRIPS', p: data || []});
      }
    },
      [state.session,
        state.role]);

    useEffect(() => {
      if (!state.session) return;
      syncData();
      const sub = supabase.channel('moto_rt_v5')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'trips'
      }, async (payload) => {
        syncData();
        const nw = payload.new;
        const ol = payload.old;

        // ── UPGRADE: Passenger push notifications for all lifecycle events ──
        if (state.role === 'passenger' && nw?.passenger_id === state.session.user.id) {
          if (nw.status === 'accepted' && ol?.status === 'searching') {
            // Driver accepted — clear search UI so trip panel takes full focus
            notify('🏍️ ' + t.accepted, `${nw.driver_name || 'Driver'} is on the way!`, 'accepted');
            setSuggestions([]);
            Keyboard.dismiss();
            const {
              data: drv
            } = await supabase.from('profiles')
            .select('current_lat,current_lng').eq('id', nw.driver_id).single();
            if (drv?.current_lat) setTargetLocation({
              latitude: drv.current_lat, longitude: drv.current_lng
            });
            // System push notification (works when app backgrounded/closed)
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🏍️ ' + (t.accepted || 'Driver Accepted'),
                body: `${nw.driver_name || 'Driver'} is on the way to pick you up!`,
                sound: true, data: {
                  tripId: nw.id, type: 'accepted'
                },
              }, trigger: null,
            }).catch(() => {});
          }
          if (nw.status === 'completion_requested') {
            notify('🏁 ' + t.confirmComplete, t.completionRequested, 'completed');
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🏁 ' + (t.confirmComplete || 'Trip Complete'),
                body: t.completionRequested || 'Driver has arrived. Confirm to pay.',
                sound: true, data: {
                  tripId: nw.id, type: 'completion'
                },
              }, trigger: null,
            }).catch(() => {});
          }
          if (nw.status === 'cancelled') {
            notify('❌ ' + t.cancel, t.cancelledAt, 'cancelled');
            setTargetLocation(null);
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '❌ ' + (t.cancel || 'Trip Cancelled'),
                body: t.cancelledAt || 'Your trip was cancelled.',
                sound: true, data: {
                  tripId: nw.id, type: 'cancelled'
                },
              }, trigger: null,
            }).catch(() => {});
          }
          if (nw.status === 'completed' && nw.passenger_id === state.session?.user?.id) {
            notify('🎉 ' + (t.tripCompleteSuccess || 'Trip Complete!'), t.tripCompleteBody || 'Thank you for using MotoLink.', 'completed');
            setPaymentModal(false); // Auto-close payment modal on trip completion
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🎉 ' + (t.tripCompleteSuccess || 'Trip Completed!'),
                body: t.tripCompleteBody || 'Thank you for using MotoLink.',
                sound: true, data: { tripId: nw.id, type: 'completed' },
              }, trigger: null,
            }).catch(() => {});
            // Prompt passenger rating
            const { data: ct } = await supabase.from('trips').select('*').eq('id', nw.id).single();
            if (ct && !ct.rated_by_passenger) {
              setTripToRate(ct); setTimeout(() => setRatingModal(true), 1200);
            }
          }
          if (nw.status === 'pre_accepted' || nw.pre_accepted_by) {
            notify('✋ ' + (t.preAccepted || 'Pre-Accepted'), `${nw.driver_name || 'Driver'} reserved your scheduled trip.`, 'accepted');
          }
          dispatch( {
            type: 'SET_ACTIVE_TRIP', p: (['cancelled', 'completed'].includes(nw.status)) ? null: nw
          });
        }

        // ── UPGRADE: Driver push notifications for all lifecycle events ──
        if (state.role === 'driver') {
          if (payload.eventType === 'INSERT' && nw.status === 'searching') {
            // New nearby request — push + in-app
            notify('🚨 New ' + t.availJobs, `${nw.passenger_name}: ${nw.pickup_address} → ${nw.destination_address}`, 'ride');
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🚨 ' + (t.nearbyRequest || 'New Nearby Request'),
                body: `${nw.passenger_name || 'Passenger'}: ${nw.pickup_address} → ${nw.destination_address}`,
                sound: true, data: {
                  tripId: nw.id, type: 'new_request'
                },
              }, trigger: null,
            }).catch(() => {});
          }
          if (payload.eventType === 'INSERT' && nw.status === 'scheduled') {
            notify('📅 ' + t.scheduledTrip, `${nw.passenger_name}: ${nw.pickup_address} → ${nw.destination_address}`, 'ride');
          }
          if (nw.status === 'awaiting_driver_confirm' && state.activeTrip?.id === nw.id) {
            notify('💰 ' + t.driverConfirm, t.paymentReceived, 'payment');
            dispatch( {
              type: 'SET_ACTIVE_TRIP', p: nw
            });
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '💰 ' + (t.driverConfirm || 'Confirm Payment'),
                body: t.paymentReceived || 'Passenger has paid. Confirm receipt.',
                sound: true, data: {
                  tripId: nw.id, type: 'payment'
                },
              }, trigger: null,
            }).catch(() => {});
          }
          if (nw.status === 'cancelled' && state.activeTrip?.id === nw.id) {
            notify('❌ ' + t.cancel, t.cancelledAt, 'cancelled');
            dispatch( {
              type: 'SET_ACTIVE_TRIP', p: null
            });
            setTargetLocation(null);
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '❌ ' + (t.cancel || 'Trip Cancelled'),
                body: t.cancelledAt || 'The trip was cancelled by the passenger.',
                sound: true, data: {
                  tripId: nw.id, type: 'cancelled'
                },
              }, trigger: null,
            }).catch(() => {});
          }
          if (nw.status === 'completed' && state.activeTrip?.id === nw.id) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🎉 ' + (t.tripCompleteSuccess || 'Trip Completed!'),
                body: t.tripCompleteBody || 'Payment confirmed. Great job!',
                sound: true, data: {
                  tripId: nw.id, type: 'completed'
                },
              }, trigger: null,
            }).catch(() => {});
          }
        }
      }).subscribe();
      return () => supabase.removeChannel(sub);
    }, [state.session, state.role, state.activeTrip, t]);

    // ══════════════════════════════════════════
    // SEARCH — Direct API calls (Photon/Geoapify, no CORS)
    // ══════════════════════════════════════════
    const handleSearchInput = (text) => {
      setSearchQuery(text);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (text.length < 2) {
        setSuggestions([]); setSearchLoading(false); return;
      }
      setSearchLoading(true);
      searchTimer.current = setTimeout(async () => {
        try {
          // Use ref so the debounced callback always sees the latest GPS coords
          const loc = myLocRef.current || state.myLocation;
          const r = await smartSearch(text, loc?.latitude, loc?.longitude);
          setSuggestions(r);
          if (r.length === 0) showBanner('🔍 MotoLink', t.notif_searchFail, 'warning');
        } catch {
          setSuggestions([]);
        } finally {
          setSearchLoading(false);
        }
      },
        350);
    };

    const triggerSearch = async () => {
      if (searchQuery.length < 2) return;
      setSearchLoading(true);
      try {
        const loc = myLocRef.current || state.myLocation;
        const r = await smartSearch(searchQuery, loc?.latitude, loc?.longitude);
        setSuggestions(r);
        if (r.length === 0) showBanner('🔍 MotoLink', t.notif_searchFail, 'warning');
      } catch {
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    };

    const selectDestination = (place) => {
      Keyboard.dismiss();
      setSuggestions([]);
      const lat = parseFloat(place.lat);
      const lng = parseFloat(place.lon);
      if (isNaN(lat) || isNaN(lng)) {
        showBanner('🔍 MotoLink', t.notif_searchFail, 'warning');
        return;
      }
      const coords = {
        latitude: lat,
        longitude: lng
      };
      const label = buildLabel(place);
      setDestCoords(coords);
      setTargetLocation(coords);
      setDestName(label);
      setSearchQuery(label);
      // Save to recent destinations (max 5)
      const recentKey = `recent_${Date.now()}`;
      const newRecent = { key: recentKey, label: '🕐 Recent', address: label, lat, lng };
      const existing = state.favorites || [];
      const noOldRecents = existing.filter(f => !f.key.startsWith('recent'));
      const oldRecents = existing.filter(f => f.key.startsWith('recent'));
      const updated = [...noOldRecents, ...oldRecents.slice(0, 4), newRecent];
      dispatch({ type: 'SET_FAVORITES', p: updated });
      saveFavorites(updated);
    };

    // ══════════════════════════════════════════
    // TRIP ACTIONS
    // ══════════════════════════════════════════
    // ══════════════════════════════════════════
    // B2B — Join Company
    // ══════════════════════════════════════════
    const joinCompany = async () => {
      if (!companyCode.trim()) return showBanner('MotoLink', t.companyCode + ' required', 'warning');
      const {
        data: company
      } = await supabase.from('companies')
      .select('*').eq('id', companyCode.trim()).eq('status', 'approved').single();
      if (!company) return showBanner('MotoLink', 'Invalid or pending company code.', 'error');
      await supabase.from('profiles').update({
        company_id: company.id, is_company_account: true
      })
      .eq('id', state.session.user.id);
      dispatch( {
        type: 'SET_PROFILE', p: {
          ...state.profile, company_id: company.id, is_company_account: true
        }
      });
      setCompanyData(company);
      showBanner('🏢 ' + t.business, `Joined ${company.name}`, 'wallet');
    };

    // ══════════════════════════════════════════
    // DRIVER ID / PERMIT SCANNING
    // ══════════════════════════════════════════
    const captureIdDocument = async (docType) => {
      // Shared: once we have an image (from native camera OR web file input),
      // store it and — for the ID document — run OCR auto-fill the same way either path.
      const processCapture = async (uri, base64) => {
        setIdScanData(prev => ({ ...prev, [`${docType}PhotoUri`]: uri }));
        if (docType !== 'id' || !base64) return;
        try {
          showBanner('🔍', 'Reading ID card — please wait...', 'info');

          // OCR.space API — send base64 image directly
          const body = new FormData();
          // Ensure the base64 string is clean (strip data URL prefix if present)
          const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
          body.append('base64Image', `data:image/jpeg;base64,${cleanBase64}`);
          body.append('language', 'eng');
          body.append('isOverlayRequired', 'false');
          body.append('detectOrientation', 'true');
          body.append('scale', 'true');
          body.append('OCREngine', '2'); // Engine 2 handles printed text better
          body.append('filetype', 'JPG');

          const res = await fetch('https://api.ocr.space/parse/image', {
            method: 'POST',
            headers: { 'apikey': 'K81978375488957' },
            body,
          });
          const json = await res.json();
          const text = (json?.ParsedResults?.[0]?.ParsedText || '').replace(/\r/g, '\n');

          if (!text.trim()) {
            showBanner('⚠️', 'Could not read ID. Make sure the image is clear and well-lit.', 'warning');
            return;
          }

          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

          // ── Rwanda National ID patterns ──────────────────────────────────
          // ID Number: 16 digits grouped as 1 YYYY D NNNNNNN CC C
          const idNumMatch = text.replace(/\s+/g, '').match(/1\d{15}/);
          const idNumber = idNumMatch ? idNumMatch[0] : '';

          // Full name — line after "Amazina / Names" label on Rwanda NID
          // Rwanda NIDs often have mixed-case names (e.g. "SANO Gerard") not pure ALL-CAPS
          let fullName = '';
          const DOC_HDR = /NATIONAL\s*IDENTITY|INDANGAMUNTU|REPUBLIC\s*OF|RWANDA|SIGNATURE|UMUKONO|IDENTITY\s*CARD|CARTE\s*D.IDENTIT/i;
          const FIELD_LABEL = /^(itariki|date\s*of|sex|igitsina|aho\s*yatan|place\s*of|signature|umukono|district|akarere|province|intara|yatangiwe)/i;
          const nameKeyIdx = lines.findIndex(l => /^(amazina|names?|surnames?|pr[eé]nom|nom\s*\/?)/i.test(l));
          if (nameKeyIdx >= 0) {
            // Look ahead up to 3 lines; accept any line that looks like a person name
            for (let i = nameKeyIdx + 1; i <= nameKeyIdx + 3 && i < lines.length; i++) {
              const ln = lines[i];
              if (!ln || DOC_HDR.test(ln) || FIELD_LABEL.test(ln)) continue;
              if (/^\d/.test(ln)) continue; // starts with digit → date/number, skip
              // Must have at least two word characters (first + last name)
              const words = ln.trim().split(/\s+/);
              if (words.length >= 2 && words[0].length >= 2) { fullName = ln.trim(); break; }
            }
          }
          // Fallback: any ALL-CAPS multi-word line that isn't a doc header
          if (!fullName) {
            const allCaps = lines.find(l =>
              /^[A-Z]{2,}(\s[A-Z]{2,})+$/.test(l) &&
              !DOC_HDR.test(l) &&
              !/RWANDA|REPUBLIC|NATIONALE|IDENTITE|NATIONAL|IDENTITY|INDANGAMUNTU/i.test(l)
            );
            fullName = allCaps || '';
          }

          // Date of birth — DD/MM/YYYY or DD-MM-YYYY
          const dobMatch = text.match(/(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})/);
          const dob = dobMatch ? `${dobMatch[1]}/${dobMatch[2]}/${dobMatch[3]}` : '';

          // District / Place of origin
          // Rwanda NID header is "Aho Yatangiwe / Place of Issue" (not "district/province")
          let origin = '';
          const districtKeyIdx = lines.findIndex(l =>
            /akarere|district|lieu|origine|intara|province|aho\s*yatan|place\s*of\s*issue|place\s*of\s*origin|yatangiwe/i.test(l)
          );
          if (districtKeyIdx >= 0) {
            for (let i = districtKeyIdx + 1; i <= districtKeyIdx + 2 && i < lines.length; i++) {
              const candidate = lines[i];
              if (!candidate || /^\d+$/.test(candidate)) continue;
              // Strip sex/gender prefix "Gabo / M" or "Gore / F" that may prefix the origin on same line
              const stripped = candidate.replace(/^(gabo|gore|M|F|male|female)\s*[\/|\\]?\s*(M|F)?\s*/i, '').trim();
              if (stripped.length >= 2) { origin = stripped; break; }
            }
          }
          // Fallback: sex and origin often appear on SAME OCR line, e.g. "Gabo / M   RUSIZI / BUGARAMA"
          if (!origin) {
            const sexLineIdx = lines.findIndex(l => /igitsina|sex\s*[\/|]|gabo\s*[\/|]|gore\s*[\/|]/i.test(l));
            if (sexLineIdx >= 0) {
              // Check same line first (inline), then next line
              const candidates = [lines[sexLineIdx], lines[sexLineIdx + 1]].filter(Boolean);
              for (const cl of candidates) {
                // Remove sex-designation part and grab the remainder
                const rem = cl.replace(/^.*?(?:\b[MF]\b|gabo|gore)\s*[\/|\\]?\s*(m|f)?\s*/i, '').trim();
                if (rem.length >= 3 && !/^\d/.test(rem)) { origin = rem; break; }
              }
            }
          }

          setIdScanData(prev => ({
            ...prev,
            idNumber:  idNumber  || prev.idNumber,
            fullName:  fullName  || prev.fullName,
            dob:       dob       || prev.dob,
            origin:    origin    || prev.origin,
          }));

          if (idNumber || fullName) {
            showBanner('✅', 'ID details read. Please verify below.', 'success');
          } else {
            showBanner('⚠️', 'Could not auto-fill all fields. Fill any missed ones manually.', 'warning');
          }
        } catch {
          showBanner('⚠️', 'Auto-read failed. Fill in details manually.', 'warning');
        }
      };

      // Web platform — show a choice: Camera or Gallery
      if (Platform.OS === 'web' || !ImagePicker) {
        if (typeof document === 'undefined') {
          showBanner('📷', 'Camera not available.', 'error'); return;
        }

          // Helper: create a file input with optional capture mode
          const openFilePicker = (captureMode) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            if (captureMode) input.setAttribute('capture', 'environment');
            input.style.display = 'none';
            input.onchange = (e) => {
              const file = e.target.files?.[0];
              document.body.removeChild(input);
              if (!file) return;

              // Profile photo: use Blob URL — renders correctly on web (data URLs can render black)
              if (docType === 'profile') {
                try {
                  const blobUrl = URL.createObjectURL(file);
                  processCapture(blobUrl, null);
                } catch {
                  // Fallback to data URL if createObjectURL fails
                  const r = new FileReader();
                  r.onload = () => processCapture(r.result || '', null);
                  r.readAsDataURL(file);
                }
                return;
              }

              // ID / permit: need base64 for OCR
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result || '';
                const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
                processCapture(dataUrl, base64);
              };
              reader.onerror = () => showBanner('📷', 'Could not read photo.', 'error');
              reader.readAsDataURL(file);
            };
            document.body.appendChild(input);
            input.click();
          };

        // Show a styled choice overlay: Camera vs Gallery
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:24px';
        overlay.innerHTML = `
          <div style="background:#10101E;border:1.5px solid rgba(212,175,55,0.35);border-radius:28px;padding:24px;width:100%;max-width:400px;box-shadow:0 0 40px rgba(212,175,55,0.15)">
            <div style="color:#D4AF37;font-weight:900;font-size:15px;text-align:center;margin-bottom:6px;letter-spacing:1px">📸 Choose Source</div>
            <div style="color:#8E8EAA;font-size:12px;text-align:center;margin-bottom:20px">How would you like to add your ${docType === 'id' ? 'National ID' : docType === 'permit' ? "Driver's Permit" : 'Profile Photo'}?</div>
            <button id="ml-cam-btn" style="width:100%;padding:18px;border-radius:18px;background:rgba(212,175,55,0.12);border:1.5px solid rgba(212,175,55,0.4);color:#D4AF37;font-weight:900;font-size:14px;letter-spacing:0.5px;cursor:pointer;margin-bottom:10px">📷 Take Photo with Camera</button>
            <button id="ml-gal-btn" style="width:100%;padding:18px;border-radius:18px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);color:#E8EAF6;font-weight:700;font-size:14px;cursor:pointer;margin-bottom:10px">🖼️ Choose from Gallery</button>
            <button id="ml-cancel-btn" style="width:100%;padding:14px;border-radius:16px;background:transparent;border:none;color:#8E8EAA;font-size:13px;cursor:pointer">Cancel</button>
          </div>`;
        document.body.appendChild(overlay);
        const remove = () => { try { document.body.removeChild(overlay); } catch {} };
        overlay.querySelector('#ml-cam-btn').onclick  = () => { remove(); openFilePicker(true);  };
        overlay.querySelector('#ml-gal-btn').onclick  = () => { remove(); openFilePicker(false); };
        overlay.querySelector('#ml-cancel-btn').onclick = remove;
        overlay.onclick = (e) => { if (e.target === overlay) remove(); };
        return;
      }

      // Native path — offer camera or gallery via Alert
      Alert.alert(
        '📷 Choose Source',
        `How would you like to add your ${docType === 'id' ? 'National ID' : docType === 'permit' ? "Driver's Permit" : 'Profile Photo'}?`,
        [
          {
            text: '📷 Camera', onPress: async () => {
              const { status } = await ImagePicker.requestCameraPermissionsAsync();
              if (status !== 'granted') { showBanner('📷', 'Camera permission needed.', 'error'); return; }
              const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, base64: true, exif: false });
              if (!result.canceled && result.assets?.[0]) await processCapture(result.assets[0].uri, result.assets[0].base64);
            }
          },
          {
            text: '🖼️ Gallery', onPress: async () => {
              const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (status !== 'granted') { showBanner('📷', 'Gallery permission needed.', 'error'); return; }
              const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, base64: true });
              if (!result.canceled && result.assets?.[0]) await processCapture(result.assets[0].uri, result.assets[0].base64);
            }
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    };

    const submitIdVerification = async () => {
      if (!idScanData.idNumber || !idScanData.fullName) {
        showBanner('⚠️', 'ID number and full name are required.', 'warning'); return;
      }
      // Upload ID photo to Supabase storage
      const uploads = {};
      for (const [key, uri] of [['id', idScanData.idPhotoUri], ['permit', idScanData.permitPhotoUri], ['profile', idScanData.profilePhotoUri]]) {
        if (!uri) continue;
        try {
          const res = await fetch(uri);
          const blob = await res.blob();
          const arr = await blob.arrayBuffer();
          const path = `drivers/${state.session.user.id}/${key}_${Date.now()}.jpg`;
          await supabase.storage.from('verification-docs').upload(path, arr, { upsert: true });
          const { data: urlData } = supabase.storage.from('verification-docs').getPublicUrl(path);
          uploads[`${key}_url`] = urlData.publicUrl;
        } catch {}
      }
      // Save verification data to profile
      await supabase.from('profiles').update({
        national_id: idScanData.idNumber,
        id_verified_name: idScanData.fullName,
        id_verified_dob: idScanData.dob,
        id_origin: idScanData.origin,
        license_url: uploads.permit_url || null,
        avatar_url: uploads.profile_url || null,
        id_submitted: true,
      }).eq('id', state.session.user.id);
      if (uploads.profile_url) {
        dispatch({ type:'SET_PROFILE', p: { ...state.profile, avatar_url: uploads.profile_url }});
      }
      showBanner('📋 ' + 'Verification Submitted', "Your documents are under review. You'll be notified once approved.", 'success');
      setIdScanModal(false);
      setIdScanMandatory(false);
    };

    // ══════════════════════════════════════════
    // DELIVERY PHOTO CAPTURE
    // ══════════════════════════════════════════
    const captureDeliveryPhoto = async (tripId) => {
      if (Platform.OS === 'web' || !ImagePicker) {
        showBanner('📷 MotoLink', 'Camera not available on web.', 'error'); return;
      }
      const {
        status
      } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showBanner('📷 MotoLink', t.notif_cameraOff, 'error'); return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7, base64: false,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        const uri = result.assets[0].uri;
        const ext = uri.split('.').pop();
        const path = `delivery/${tripId}.${ext}`;
        const res = await fetch(uri);
        const blob = await res.blob();
        const arr = await blob.arrayBuffer();
        await supabase.storage.from('verification-docs').upload(path, arr, {
          upsert: true
        });
        const {
          data: urlData
        } = supabase.storage.from('verification-docs').getPublicUrl(path);
        await supabase.from('trips').update({
          delivery_photo_url: urlData.publicUrl
        }).eq('id', tripId);
        showBanner('📸 Photo saved', 'Delivery confirmed with photo.', 'completed');
      }
    };

    // ══════════════════════════════════════════
    // LEADERBOARD WEEKLY BONUS
    // ══════════════════════════════════════════
    const checkAndAwardLeaderboard = async () => {
      await loadLeaderboard();
      const {
        data: leaders
      } = await supabase.from('driver_leaderboard').select('*').limit(1);
      if (leaders?.[0]) {
        const top = leaders[0];
        const {
          data: profile
        } = await supabase.from('profiles')
        .select('wallet_balance').eq('id', top.id).single();
        if (profile) {
          const newBal = (profile.wallet_balance || 0) + LEADERBOARD_BONUS;
          await supabase.from('profiles').update({
            wallet_balance: newBal
          }).eq('id', top.id);
          await supabase.from('transactions').insert([{
            user_id: top.id, type: 'bonus', amount: LEADERBOARD_BONUS,
            balance_after: newBal, description: 'Weekly leaderboard #1 bonus', status: 'completed', method: 'bonus',
          }]);
          const tk = await getPushToken(top.id);
          if (tk) await sendExpoPush(tk, '🏆 Weekly Champion!', `You were #1 this week! ${fmtFRW(LEADERBOARD_BONUS)} bonus added.`, {
            type: 'wallet'
          });
        }
      }
    };

    // ══════════════════════════════════════════
    // REQUEST RIDE — enhanced with all modes
    // ══════════════════════════════════════════
    const requestRide = async () => {
      if (!state.myLocation) return showBanner('📍 GPS', t.notif_noGPS, 'location');
      if (!destCoords) return showBanner('MotoLink', t.searchHint, 'warning');
      if (!state.session) return showBanner('MotoLink', t.signIn, 'warning');
      if (!isOnline) return showBanner(t.offlineMode, t.notif_noInternet, 'offline');

      // Scheduled trip validation
      if (tripMode === 'later') {
        if (!scheduledFor) return showBanner('📅 MotoLink', t.notif_scheduleNoTime, 'warning');
        if (scheduledFor <= new Date()) return showBanner('⏰ MotoLink', t.notif_schedulePast, 'warning');
        const minAdvance = 10;
        if ((scheduledFor - new Date()) < minAdvance * 60 * 1000)
          return showBanner('⏰ MotoLink', t.notif_schedulePast, 'warning');
      }

      // Delivery mode validation
      if (serviceMode === 'delivery') {
        if (!packageDesc.trim()) return showBanner('MotoLink', t.packageDesc + ' required', 'warning');
        if (!recipientName.trim()) return showBanner('MotoLink', t.recipientName + ' required', 'warning');
        if (!recipientPhone.trim()) return showBanner('MotoLink', t.recipientPhone + ' required', 'warning');
      }

      const snapDest = {
        ...destCoords
      };
      const snapLoc = {
        ...state.myLocation
      };
      const snapName = destName;
      setRideLoading(true);

      // Multi-stop fare: sum of all segments
      let totalDist = getDistance(snapLoc.latitude, snapLoc.longitude,
        stops.length > 0 ? stops[0].lat: snapDest.latitude,
        stops.length > 0 ? stops[0].lng: snapDest.longitude);
      for (let i = 0; i < stops.length - 1; i++) {
        totalDist = String(parseFloat(totalDist) + parseFloat(getDistance(stops[i].lat, stops[i].lng, stops[i+1].lat, stops[i+1].lng)));
      }
      if (stops.length > 0) {
        const last = stops[stops.length-1];
        totalDist = String(parseFloat(totalDist) + parseFloat(getDistance(last.lat, last.lng, snapDest.latitude, snapDest.longitude)));
      }

      const fromAddr = await reverseGeocode(snapLoc.latitude, snapLoc.longitude);

      // SCHEDULED TRIPS: Never apply surge — the fare is locked at the non-surge distance
      // rate when the passenger books. If it's a 'now' trip during peak hours, surge applies.
      let currentSurge = 1.0;
      if (tripMode === 'now') {
        // Only now-trips check for real-time surge
        currentSurge = await getSurgeMultiplier();
      }
      // Scheduled trips always use base rate (multiplier=1.0) regardless of booking time
      const fareAmt = calcFareWithSurge(totalDist, currentSurge);
      const discountAmt = promoData?.discount || 0;
      const finalPrice = Math.max(0, fareAmt - discountAmt);
      const commission = Math.round(finalPrice * COMMISSION_RATE);

      const tripPayload = {
        passenger_id: state.session.user.id,
        passenger_phone: state.session.user.phone,
        pickup_lat: snapLoc.latitude,
        pickup_lng: snapLoc.longitude,
        pickup_address: fromAddr,
        destination_lat: snapDest.latitude,
        destination_lng: snapDest.longitude,
        destination_address: snapName,
        price: fareAmt,
        discount_amount: discountAmt,
        final_price: finalPrice,
        commission,
        driver_earnings: finalPrice - commission,
        status: tripMode === 'later' ? 'scheduled': 'searching',
        passenger_name: state.profile?.name || 'Passenger',
        payment_method: paymentMethod,
        payment_status: 'pending',
        promo_code: promoData?.code || null,
        stops: stops.length > 0 ? JSON.stringify(stops): null,
        current_stop_index: 0,
        trip_type: serviceMode,
        package_description: serviceMode === 'delivery' ? packageDesc: null,
        recipient_name: serviceMode === 'delivery' ? recipientName: null,
        recipient_phone: serviceMode === 'delivery' ? recipientPhone: null,
        scheduled_for: tripMode === 'later' ? scheduledFor?.toISOString(): null,
        is_scheduled: tripMode === 'later',
        // company_id: add column first: ALTER TABLE trips ADD COLUMN IF NOT EXISTS company_id uuid;
      };

      // Offline queue if no internet
      if (!isOnline) {
        const queue = [...offlineQueue,
          tripPayload];
        setOfflineQueue(queue);
        await AsyncStorage.setItem(OFFLINE_TRIPS_KEY, JSON.stringify(queue));
        setRideLoading(false);
        clearPromo();
        setDestCoords(null); setSearchQuery(''); setDestName('');
        setStops([]); setPackageDesc(''); setRecipientName(''); setRecipientPhone('');
        showBanner('📡 ' + t.offlineMode, t.queuedRequest, 'search');
        return;
      }

      const {
        data: tripRow,
        error
      } = await supabase.from('trips').insert([tripPayload]).select().single();
      setRideLoading(false);

      if (error) {
        showBanner('MotoLink', error.message, 'error');
      } else {
        // Promo usage tracking
        if (promoData?.code && tripRow?.id) {
          await supabase.from('promo_usage').insert([{
            code: promoData.code, user_id: state.session.user.id,
            trip_id: tripRow.id, discount: discountAmt,
          }]);
          await supabase.rpc('increment_promo', {
            code_val: promoData.code
          }).catch(()=> {});
        }
        // B2B monthly spend tracking
        if (state.profile?.company_id) {
          await supabase.from('companies').update({
            monthly_spend: supabase.rpc('add_spend', {
              cid: state.profile.company_id, amount: finalPrice
            })
          }).eq('id', state.profile.company_id).catch(()=> {});
        }
        clearPromo();
        setDestCoords(null); setSearchQuery(''); setDestName('');
        setStops([]); setPackageDesc(''); setRecipientName(''); setRecipientPhone('');
        setTripMode('now'); setScheduledFor(null);

        const banner = tripMode === 'later'
        ? `📅 ${t.scheduledTrip}`: (serviceMode === 'delivery' ? '📦 Delivery requested': '🛵 ' + t.pending);
        showBanner(banner, fromAddr + ' → ' + snapName, 'search');
        // ── UPGRADE: Local OS notification for passenger (works when switching apps) ──
        await Notifications.scheduleNotificationAsync({
          content: {
            title: tripMode === 'later' ? `📅 ${t.scheduledTrip}`: (t.requestSent || '🛵 Request Sent!'),
            body: tripMode === 'later'
            ? `${fromAddr} → ${snapName} — scheduled for ${scheduledFor?.toLocaleTimeString([], {
              hour: '2-digit', minute: '2-digit'
            })}`: (t.requestSentBody || 'Searching for a nearby driver...'),
            sound: true, data: {
              type: tripMode === 'later' ? 'scheduled': 'searching'
            },
          }, trigger: null,
        }).catch(() => {});
        if (!state.menuOpen) dispatch( {
          type: 'TOGGLE_MENU'
        });

        // Push to drivers
        const {
          data: drivers
        } = await supabase.from('profiles')
        .select('push_token').eq('role', 'driver').not('push_token', 'is', null);
        if (drivers) for (const drv of drivers) {
          if (drv.push_token) await sendExpoPush(
            drv.push_token,
            tripMode === 'later' ? `📅 Scheduled: ${t.availJobs}`: `🚨 New ${t.availJobs}`,
            `${state.profile?.name}: ${fromAddr} → ${snapName}`,
            {
              type: tripMode === 'later' ? 'scheduled': 'ride'
            }
          );
        }
      }
    };
    const acceptTrip = async (job) => {
      // Check driver has SOME payment info — MTN OR Airtel is fine
      if (!state.profile?.momo_number && !state.profile?.momo_merchant_code && !state.profile?.airtel_number) {
        showBanner('⚠️ ' + t.paymentSetup, t.noPaymentWarning, 'warning');
        setPaySetupModal(true);
        return;
      }

      // Shared finalise logic — runs after any successful update
      const finaliseAccept = async (updatedTrip) => {
        dispatch({ type: 'SET_ACTIVE_TRIP', p: updatedTrip });
        saveActiveTrip(updatedTrip).catch(() => {});
        setTargetLocation({ latitude: job.pickup_lat, longitude: job.pickup_lng });
        const tk = await getPushToken(job.passenger_id);
        await sendExpoPush(
          tk,
          '🏍️ ' + t.accepted,
          `${state.profile?.name || 'Driver'} accepted your ride: ${job.pickup_address} → ${job.destination_address}`,
          { type: 'accepted' }
        );
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🚦 ' + (t.activeJob || 'Active Mission'),
            body: `Pickup: ${job.pickup_address} → ${job.destination_address} — ${fmtFRW(job.price)}`,
            sound: true, data: { tripId: job.id, type: 'accepted' },
          }, trigger: null,
        }).catch(() => {});
        showBanner('🏍️ ' + t.accepted, `${job.pickup_address} → ${job.destination_address}`, 'accepted');
      };

      // Attempt 1: Full update with all optional fields (driver_plate, accepted_at)
      const { data: rows1, error: err1 } = await supabase.from('trips').update({
        status: 'accepted',
        driver_id: state.session.user.id,
        driver_phone: state.session.user.phone,
        driver_name: state.profile?.name || 'Driver',
        driver_plate: state.profile?.plate || state.profile?.plate_number || '',
        accepted_at: new Date().toISOString(),
      }).eq('id', job.id).eq('status', 'searching').select();

      if (!err1) {
        if (!rows1 || rows1.length === 0) {
          showBanner('⚠️ MotoLink', 'This ride was already accepted by another driver.', 'warning');
          syncData(); return;
        }
        await finaliseAccept(rows1[0]); return;
      }

      // Attempt 2: Retry without optional columns that may not exist in all schema versions
      const { data: rows2, error: err2 } = await supabase.from('trips').update({
        status: 'accepted',
        driver_id: state.session.user.id,
        driver_phone: state.session.user.phone,
        driver_name: state.profile?.name || 'Driver',
      }).eq('id', job.id).eq('status', 'searching').select();

      if (err2) {
        const hint = err2.message || err2.details || 'Try again.';
        showBanner('⚠️ MotoLink', `Could not accept: ${hint}`, 'error');
        return;
      }
      if (!rows2 || rows2.length === 0) {
        showBanner('⚠️ MotoLink', 'This ride was already accepted by another driver.', 'warning');
        syncData(); return;
      }
      await finaliseAccept(rows2[0]);
    };

    // Driver arrives and requests completion
    const requestCompletion = async()=> {
      if (!state.activeTrip) return;
      await supabase.from('trips').update({
        status: 'completion_requested', completion_requested_at: new Date().toISOString()
      }).eq('id', state.activeTrip.id);
      dispatch( {
        type: 'SET_ACTIVE_TRIP', p: {
          ...state.activeTrip, status: 'completion_requested'
        }
      });
      const tk = await getPushToken(state.activeTrip.passenger_id);
      await sendExpoPush(tk, '🏁 '+t.confirmComplete, t.completionRequested, {
        type: 'completed'
      });
      showBanner('🏁', t.completionRequested, 'completed');
    };

    // ── Mark next stop reached (multi-stop) ──
    const markStopReached = async () => {
      if (!state.activeTrip) return;
      const tripStops = state.activeTrip.stops ? JSON.parse(state.activeTrip.stops): [];
      const nextIndex = (state.activeTrip.current_stop_index || 0) + 1;
      const allReached = nextIndex >= tripStops.length;
      await supabase.from('trips').update({
        current_stop_index: nextIndex
      }).eq('id', state.activeTrip.id);
      dispatch( {
        type: 'SET_ACTIVE_TRIP', p: {
          ...state.activeTrip, current_stop_index: nextIndex
        }
      });
      if (allReached) {
        showBanner('✅', t.allStopsReached, 'completed');
      } else {
        const nextStop = tripStops[nextIndex];
        if (nextStop) setTargetLocation({
          latitude: nextStop.lat, longitude: nextStop.lng
        });
        showBanner('📍 ' + t.nextStop, nextStop?.name || 'Next stop', 'search');
      }
    };

    // ── Update delivery status ────────────────
    const updateDeliveryStatus = async (newStatus) => {
      if (!state.activeTrip) return;
      await supabase.from('trips').update({
        status: newStatus
      }).eq('id', state.activeTrip.id);
      dispatch( {
        type: 'SET_ACTIVE_TRIP', p: {
          ...state.activeTrip, status: newStatus
        }
      });
      if (newStatus === 'picked_up') {
        const tk = await getPushToken(state.activeTrip.passenger_id);
        await sendExpoPush(tk, '📦 Package Picked Up!', 'Your package is on the way.', {
          type: 'accepted'
        });
        showBanner('📦', t.pickedUp_del, 'accepted');
      }
      if (newStatus === 'delivered') {
        // Take photo then complete
        await captureDeliveryPhoto(state.activeTrip.id);
        const tk = await getPushToken(state.activeTrip.passenger_id);
        await sendExpoPush(tk, '✅ Package Delivered!', 'Your package has been delivered.', {
          type: 'completed'
        });
        showBanner('✅', t.delivered_del, 'completed');
        dispatch( {
          type: 'SET_ACTIVE_TRIP', p: null
        });
        setTargetLocation(null);
      }
    };

    // ── UPGRADE: Pre-accept a scheduled trip — with push to passenger, blocks double-accept ──
    const preAcceptScheduledTrip = async (tripId) => {
      // Allow pre-accept if driver has either MTN or Airtel set up
      if (!state.profile?.momo_number && !state.profile?.momo_merchant_code && !state.profile?.airtel_number) {
        showBanner('⚠️ ' + t.paymentSetup, t.noPaymentWarning, 'warning');
        setPaySetupModal(true);
        return;
      }
      const {
        data: existing
      } = await supabase.from('trips')
      .select('pre_accepted_by, passenger_name, passenger_phone, pickup_address, destination_address, passenger_id')
      .eq('id', tripId).single();
      if (existing?.pre_accepted_by) {
        showBanner('⚠️ MotoLink', 'This trip has already been reserved by another driver.', 'warning');
        return;
      }
      const {
        error
      } = await supabase.from('trips').update({
          pre_accepted_by: state.session.user.id,
          driver_id: state.session.user.id,
          driver_name: state.profile?.name || 'Driver',
          driver_phone: state.session.user.phone,
        }).eq('id', tripId).is('pre_accepted_by', null);

      if (!error) {
        showBanner('📅 ' + (t.preAccepted || 'Pre-Accepted'), `${existing?.pickup_address || ''} → ${existing?.destination_address || ''}`, 'accepted');
        syncData();
        if (existing?.passenger_id) {
          const tk = await getPushToken(existing.passenger_id);
          await sendExpoPush(
            tk,
            '✋ ' + (t.preAccepted || 'Trip Reserved'),
            `${state.profile?.name || 'Driver'} has reserved your scheduled trip: ${existing.pickup_address} → ${existing.destination_address}`,
            { type: 'accepted' }
          );
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '✋ ' + (t.preAccepted || 'Driver Reserved'),
              body: `${state.profile?.name || 'A driver'} reserved your scheduled trip.`,
              sound: true, data: { tripId, type: 'pre_accepted' },
            }, trigger: null,
          }).catch(() => {});
        }
      } else {
        showBanner('⚠️ MotoLink', 'Could not reserve trip. It may have been taken.', 'error');
      }
    };

    // Passenger confirms complete → shows payment modal
    const passengerConfirmComplete = async () => {
      if (!state.activeTrip) return;
      // Fetch driver payment profile — fetch both MTN and Airtel info
      const {
        data: drvPay
      } = await supabase
      .from('profiles')
      .select('momo_type,momo_number,momo_merchant_code,momo_name,airtel_number')
      .eq('id', state.activeTrip.driver_id)
      .single();
      setDriverPayProfile(drvPay || {
        momo_type: 'personal', momo_number: null, momo_merchant_code: null, momo_name: null, airtel_number: null
      });
      // Mark passenger confirmed time — non-blocking
      supabase.from('trips').update({
        passenger_confirmed_at: new Date().toISOString(),
      }).eq('id', state.activeTrip.id).then(() => {});
      dispatch( {
        type: 'SET_ACTIVE_TRIP', p: {
          ...state.activeTrip, status: 'completion_requested', passenger_confirmed_at: new Date().toISOString()
        }
      });
      setPaymentModal(true);
    };

    // Passenger confirms paid (MoMo, Airtel, or cash)
    const passengerConfirmedPayment = async(method)=> {
      if (!state.activeTrip) return;
      const paymentStatus = method === 'momo' ? 'paid_momo' : method === 'airtel' ? 'paid_airtel' : 'paid_cash';
      const { error } = await supabase.from('trips').update({
        status: 'awaiting_driver_confirm',
        momo_payment_method: method,
        payment_status: paymentStatus,
      }).eq('id', state.activeTrip.id);
      if (error) {
        showBanner('❌ MotoLink', 'Payment confirmation failed. Try again.', 'error');
        return;
      }
      dispatch({
        type: 'SET_ACTIVE_TRIP', p: {
          ...state.activeTrip, status: 'awaiting_driver_confirm'
        }
      });
      // Push to driver
      const tk = await getPushToken(state.activeTrip.driver_id);
      await sendExpoPush(tk, '💰 ' + t.driverConfirm, t.paymentReceived, { type: 'payment' });
      showBanner('✓', t.awaitingDriverConfirm || 'Payment noted! Awaiting driver confirmation.', 'payment');

      // Close payment modal and show passenger rating immediately
      // (don't make passenger wait for driver to manually confirm)
      setPaymentModal(false);
      const tripId = state.activeTrip.id;
      const { data: ct } = await supabase.from('trips').select('*').eq('id', tripId).single();
      const rateTarget = ct || { ...state.activeTrip, id: tripId };
      if (!rateTarget.rated_by_passenger) {
        setTripToRate(rateTarget);
        setTimeout(() => setRatingModal(true), 700);
      }
    };

    // Driver confirms payment received → trip complete
    const driverConfirmPayment = async () => {
      if (!state.activeTrip) return;
      const passId = state.activeTrip.passenger_id;
      const tripSnap = {
        ...state.activeTrip
      };
      await supabase.from('trips').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        driver_confirmed_at: new Date().toISOString(),
        payment_status: 'completed',
      }).eq('id', state.activeTrip.id);
      showBanner('🎉 ' + t.completeTrip, t.paymentReceived, 'completed');
      dispatch( {
        type: 'SET_ACTIVE_TRIP', p: null
      });
      setTargetLocation(null);
      // ── UPGRADE: Full push to passenger on trip complete ──
      const tk = await getPushToken(passId);
      await sendExpoPush(
        tk,
        '🎉 ' + (t.tripCompleteSuccess || 'Trip Completed!'),
        `${tripSnap.pickup_address} → ${tripSnap.destination_address} — ${fmtFRW(tripSnap.final_price || tripSnap.price)}`,
        {
          type: 'completed'
        }
      );
      // Local OS notification for driver
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🎉 ' + (t.tripCompleteSuccess || 'Trip Completed!'),
          body: `Payment confirmed. Earnings: ${fmtFRW(tripSnap.driver_earnings || 0)}`,
          sound: true, data: {
            tripId: tripSnap.id, type: 'completed'
          },
        }, trigger: null,
      }).catch(() => {});
      // Prompt driver to rate passenger
      const {
        data: ct
      } = await supabase.from('trips').select('*').eq('id', tripSnap.id).single();
      if (ct && !ct.rated_by_driver) {
        setTripToRate(ct); setTimeout(() => setRatingModal(true), 800);
      }
    };

    const cancelTrip = async(id, otherUserId = null)=> {
      // Drivers can only cancel trips they personally accepted (driver_id matches their own id)
      // Passengers can cancel any of their own trips (passenger_id matches)
      const uid = state.session?.user?.id;
      const col = state.role === 'driver' ? 'driver_id': 'passenger_id';
      await supabase.from('trips').update({
        status: 'cancelled', cancelled_at: new Date().toISOString()
      }).eq('id', id).eq(col, uid);
      if (state.activeTrip?.id === id) {
        dispatch( {
          type: 'SET_ACTIVE_TRIP', p: null
        }); setTargetLocation(null);
      }
      if (otherUserId) {
        const tk = await getPushToken(otherUserId);
        const isDriver = state.role === 'driver';
        await sendExpoPush(tk, isDriver?t.driver+' '+t.cancel: t.pax+' '+t.cancel, t.cancelledAt, {
          type: 'cancelled'
        });
      }
    };

    // ── Live trip share — generates tracking link + native share sheet ──
    const handleShareLiveTrip = async (tripId) => {
      if (!AT) return;
      // Build the tracking link — recipients open this in a browser
      const trackingUrl = `https://motolinkt.netlify.app?tripId=${tripId}`;
      const msg = `🏍️ I'm on a MotoLink ride!\n📍 From: ${AT.pickup_address}\n🎯 To: ${AT.destination_address}\n💰 ${fmtFRW(AT.price)}\n\n🔗 Track my live trip:\n${trackingUrl}\n\nStay safe! 🙏`;
      try {
        await Share.share({ message: msg, url: trackingUrl });
      } catch {
        // Fallback: WhatsApp deep-link
        const wa = `https://wa.me/?text=${encodeURIComponent(msg)}`;
        Linking.openURL(wa).catch(() => showBanner('❌', 'Could not open share.', 'error'));
      }
    };

    // ══════════════════════════════════════════
    // 18. RENDER
    // ══════════════════════════════════════════

    // Loading while restoring session
    if (!state.hydrated || state.step === 'splash') {
      if (!state.hydrated) return (
        <View style={[styles.splashContainer, { justifyContent: 'center', alignItems: 'center' }]}>
          <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
          <Text style={styles.splashTitle}>MOTOLINK</Text>
          <ActivityIndicator color={C.gold} style={ { marginTop: 30 }} />
        </View>
      );
      return <SplashScreen onFinish={()=>dispatch( { type: 'SET_STEP', p: 'lang' })} />;
    }

    if (state.step === 'lang') return (
      <View style={styles.authView}>
        <View style={ { alignItems: 'center', marginBottom: 36 }}>
          <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
          <Text style={styles.splashTitle}>MOTOLINK</Text>
        </View>
        <Text style={ { color: C.gray, textAlign: 'center', marginBottom: 24, letterSpacing: 1 }}>Select Language</Text>
        {Object.keys(LANG).map(k => (
          <TouchableOpacity key={k} style={styles.langBtn}
            onPress={()=> { dispatch( { type: 'SET_LANG', p: k }); dispatch( { type: 'SET_STEP', p: 'auth' }); }}>
            <Text style={styles.langTxt}>{k === 'en'?'🇬🇧  English': k === 'rw'?'🇷🇼  Kinyarwanda': '🇫🇷  Français'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );

    if (state.step === 'auth') return (
      <>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios'?'padding': 'height'}
        style={ { flex: 1, backgroundColor: C.black }}>
        {/* ── Vibrant background depth layers — the "4K look" ── */}
        <View pointerEvents="none" style={{ position:'absolute', inset:0, overflow:'hidden' }}>
          {/* Primary gold radial orb — top-right */}
          <View style={{ position:'absolute', top:-120, right:-80, width:320, height:320, borderRadius:160,
            backgroundColor:'rgba(212,175,55,0.09)', transform:[{scaleX:1.3}] }} />
          {/* Secondary purple accent — bottom-left */}
          <View style={{ position:'absolute', bottom:-60, left:-100, width:280, height:280, borderRadius:140,
            backgroundColor:'rgba(168,85,247,0.07)' }} />
          {/* Subtle blue mid orb */}
          <View style={{ position:'absolute', top:'38%', left:'20%', width:200, height:200, borderRadius:100,
            backgroundColor:'rgba(61,142,248,0.05)' }} />
        </View>
        <ScrollView contentContainerStyle={styles.authView} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={ { alignItems: 'center', marginBottom: 8 }}>
            <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
            <Text style={styles.splashTitle}>{t.welcome}</Text>
            <Text style={ { color: C.gray, fontSize: 13, letterSpacing: 1, marginBottom: 28 }}>{t.slogan}</Text>
          </View>
          <View style={styles.roleRow}>
            {['passenger', 'driver'].map(r => (
              <PressableScale key={r} onPress={()=>dispatch( { type: 'SET_ROLE', p: r })}
                style={[styles.roleBtn, state.role === r && styles.activeRole]} activeScale={0.93}>
                <Text style={ { fontSize: 22, marginBottom: 4 }}>{r === 'passenger'?'🧑': '🏍️'}</Text>
                <Text style={[styles.roleTxt, state.role === r && { color: C.gold }]}>{r === 'passenger'?t.pax: t.driver}</Text>
              </PressableScale>
            ))}
          </View>
          {authMode === 'signup' && (
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>{t.name}</Text>
              <TextInput style={styles.input} placeholder="e.g. Jean Pierre" placeholderTextColor={C.grayDark} value={nameVal} onChangeText={setNameVal} />
            </View>
          )}
          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>{t.phone}</Text>
            <TextInput style={styles.input} placeholder="+250 7XX XXX XXX" placeholderTextColor={C.grayDark} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
          </View>
          <View style={styles.inputWrap}>
            <Text style={styles.inputLabel}>{t.pass}</Text>
            <View style={styles.passRow}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="••••••••" placeholderTextColor={C.grayDark} value={password} onChangeText={setPassword} secureTextEntry={!showPass} />
              <TouchableOpacity onPress={()=>setShowPass(!showPass)} style={styles.eyeBtn}><Text style={styles.eyeIcon}>{showPass?'🙈': '👁️'}</Text></TouchableOpacity>
            </View>
          </View>
          {authMode === 'signup' && (
            <>
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>{t.confirmPass}</Text>
                <View style={styles.passRow}>
                  <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="••••••••" placeholderTextColor={C.grayDark} value={confirmPass} onChangeText={setConfirmPass} secureTextEntry={!showConfirm} />
                  <TouchableOpacity onPress={()=>setShowConfirm(!showConfirm)} style={styles.eyeBtn}><Text style={styles.eyeIcon}>{showConfirm?'🙈': '👁️'}</Text></TouchableOpacity>
                </View>
                {confirmPass.length > 0 && <Text style={ { color: password === confirmPass?C.green: C.red, fontSize: 12, marginTop: 6, marginLeft: 4 }}>{password === confirmPass?t.passMatch: t.passMismatch}</Text>}
              </View>
              {/* Referral code input — signup only */}
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>{t.enterRefCode}</Text>
                <TextInput style={styles.input}
                  placeholder="ML-XXXXXX"
                  placeholderTextColor={C.grayDark}
                  value={refCodeInput}
                  onChangeText={v=>setRefCodeInput(v.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={9}
                  />
              </View>
            </>
          )}
          <PressableScale style={styles.mainBtn} onPress={handleAuth} disabled={authLoading} activeScale={0.96}>
            {authLoading?<ActivityIndicator color={C.black} />: <Text style={styles.mainBtnTxt}>{authMode === 'signin'?t.signIn.toUpperCase(): t.signUp.toUpperCase()}</Text>}
          </PressableScale>
          {authMode === 'signup' && (
            <View style={{ flexDirection:'row', alignItems:'center', marginTop:14, gap:10, paddingHorizontal:4 }}>
              <View style={{ width:16, height:16, borderRadius:4, borderWidth:1.5, borderColor:C.gold, backgroundColor:C.goldDim, alignItems:'center', justifyContent:'center' }}>
                <Text style={{ color:C.gold, fontSize:11, fontWeight:'900' }}>✓</Text>
              </View>
              <Text style={{ color:C.gray, fontSize:11, flex:1, lineHeight:16 }}>
                By signing up you agree to our{' '}
                <Text style={{ color:C.gold, textDecorationLine:'underline' }} onPress={() => setShowTOS(true)}>Terms of Service</Text>
                {' '}and{' '}
                <Text style={{ color:C.gold, textDecorationLine:'underline' }} onPress={() => setShowPrivacy(true)}>Privacy Policy</Text>
              </Text>
            </View>
          )}
          <TouchableOpacity onPress={()=> { setAuthMode(authMode === 'signin'?'signup': 'signin'); setPhone(''); setPassword(''); setConfirmPass(''); setNameVal(''); }} style={ { marginTop: 16 }}>
            <Text style={ { color: C.gold, textAlign: 'center', fontSize: 14 }}>{authMode === 'signin'?t.newAcc: t.hasAcc}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ══ TERMS OF SERVICE MODAL — reachable from the auth/signup screen ══ */}
      <Modal visible={showTOS} animationType="slide" transparent={false}>
        <View style={{ flex:1, backgroundColor: C.black }}>
          <View style={{ backgroundColor: C.charcoal, paddingTop: Platform.OS==='android'?(StatusBar.currentHeight||0)+8:44, paddingBottom:14, paddingHorizontal:20, borderBottomWidth:1, borderBottomColor:C.border }}>
            <View style={{ alignItems:'center', marginBottom:6 }}>
              <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
            </View>
            <Text style={{ color:C.gold, fontWeight:'900', fontSize:18, textAlign:'center', letterSpacing:1 }}>{t.tos_title}</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding:20, paddingBottom:40 }} showsVerticalScrollIndicator={false}>
            {[
              { title: t.tos_s1_title, body: t.tos_s1_body },
              { title: t.tos_s2_title, body: t.tos_s2_body },
              { title: t.tos_s3_title, body: t.tos_s3_body },
              { title: t.tos_s4_title, body: t.tos_s4_body },
              { title: t.tos_s5_title, body: t.tos_s5_body },
              { title: t.tos_s6_title, body: t.tos_s6_body },
              { title: t.tos_s7_title, body: t.tos_s7_body },
            ].map((sec, i) => (
              <View key={i}>
                <Text style={{ color:C.gold, fontWeight:'900', fontSize:15, marginBottom:8 }}>{sec.title}</Text>
                <Text style={{ color:C.offWhite, fontSize:13, lineHeight:21, marginBottom:16 }}>{sec.body}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={{ padding:20, borderTopWidth:1, borderTopColor:C.border, backgroundColor:C.charcoal }}>
            <TouchableOpacity
              style={[styles.mainBtn, { marginBottom:10 }]}
              onPress={async () => {
                await AsyncStorage.setItem('@motolink_tos_accepted', '1');
                setTosAccepted(true);
                setShowTOS(false);
              }}>
              <Text style={styles.mainBtnTxt}>{t.tos_agree}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPrivacy(true)} style={{ alignItems:'center', paddingVertical:8 }}>
              <Text style={{ color:C.gray, fontSize:12, textDecorationLine:'underline' }}>{t.tos_readPrivacy}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowTOS(false)} style={{ alignItems:'center', paddingVertical:8 }}>
              <Text style={{ color:C.grayDark, fontSize:12 }}>{t.close}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ══ PRIVACY POLICY MODAL — reachable from the auth/signup screen ══ */}
      <Modal visible={showPrivacy} animationType="slide" transparent={false}>
        <View style={{ flex:1, backgroundColor:C.black }}>
          <View style={{ backgroundColor:C.charcoal, paddingTop:Platform.OS==='android'?(StatusBar.currentHeight||0)+8:44, paddingBottom:14, paddingHorizontal:20, borderBottomWidth:1, borderBottomColor:C.border, flexDirection:'row', alignItems:'center' }}>
            <TouchableOpacity onPress={() => setShowPrivacy(false)} style={{ marginRight:12 }}>
              <Text style={{ color:C.gold, fontSize:18 }}>←</Text>
            </TouchableOpacity>
            <Text style={{ color:C.gold, fontWeight:'900', fontSize:16, flex:1 }}>{t.privacy_title}</Text>
          </View>
          <ScrollView contentContainerStyle={{ padding:20, paddingBottom:40 }}>
            <Text style={{ color:C.offWhite, fontSize:13, lineHeight:22, marginBottom:16 }}>{t.privacy_updated}</Text>
            {[
              { title: t.privacy_s1_title, body: t.privacy_s1_body },
              { title: t.privacy_s2_title, body: t.privacy_s2_body },
              { title: t.privacy_s3_title, body: t.privacy_s3_body },
              { title: t.privacy_s4_title, body: t.privacy_s4_body },
              { title: t.privacy_s5_title, body: t.privacy_s5_body },
            ].map((sec, i) => (
              <View key={i}>
                <Text style={{ color:C.gold, fontWeight:'900', fontSize:14, marginBottom:8 }}>{sec.title}</Text>
                <Text style={{ color:C.offWhite, fontSize:13, lineHeight:21, marginBottom:16 }}>{sec.body}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
      </>
    );

    // ── MAIN APP ─────────────────────────────
    const AT = state.activeTrip;
    const isCompletionRequested = AT?.status === 'completion_requested';
    const isAwaitingDriverConfirm = AT?.status === 'awaiting_driver_confirm';

    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={C.black} translucent={false} />
        <MapComponent
          myLoc={state.myLocation}
          targetLoc={
          state.role === 'driver'
          ? (AT ? targetLocation: null): targetLocation
          }
          mapRef={mapBridgeRef}
          bottomOffset={AT || (state.role === 'driver' && state.jobs?.length > 0) ? 220: 0}
          onLongPress={async (coords) => {
            if (state.role === 'passenger' && !AT) {
              const pinLabel = `📌 ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
              setDestCoords({ latitude: coords.latitude, longitude: coords.longitude });
              setTargetLocation({ latitude: coords.latitude, longitude: coords.longitude });
              setDestName(pinLabel);
              setSearchQuery(pinLabel);
              setSuggestions([]);
              showBanner('📌 MotoLink', t.notif_mapPin, 'location');
              // Reverse geocode in background and update label
              reverseGeocode(coords.latitude, coords.longitude).then(addr => {
                if (addr && !addr.includes(',')) return; // too short, skip
                setDestName(addr);
                setSearchQuery(addr);
              }).catch(() => {});
            }
          }}
          onBridgeMessage={(m) => {
            // Only used for SEARCH/RESOLVE from WebView if bridge approach re-enabled
            if (m.type === 'SEARCH_RESULTS') {
              setSuggestions(m.results || []);
              setSearchLoading(false);
            }
            if (m.type === 'RESOLVE_RESULT' && m.lat && m.lng) {
              setSearchLoading(false);
              const coords = { latitude: m.lat,
                longitude: m.lng };
              setDestCoords(coords);
              setTargetLocation(coords);
              setDestName(m.label || '');
              setSearchQuery(m.label || '');
            }
          }}
          />
        <NotificationBanner data={state.banner} onHide={()=>dispatch( { type: 'HIDE_BANNER' })} />

        {/* Rating modal */}
        <RatingModal visible={ratingModal} trip={tripToRate} role={state.role} t={t}
          onSubmit={submitRating} onSkip={()=> { setRatingModal(false); setTripToRate(null); }} />

        {/* Payment modal — passenger pays driver */}
        <PaymentModal visible={paymentModal} trip={AT} driverProfile={driverPayProfile} t={t}
          defaultMethod={AT?.payment_method}
          onPaid={passengerConfirmedPayment} onCash={()=> { setPaymentModal(false); passengerConfirmedPayment('cash'); }} onClose={()=>setPaymentModal(false)} />

        {/* Driver payment setup modal */}
        <PaymentSetupModal visible={paySetupModal} profile={state.profile} t={t}
          onSave={savePaymentInfo} onClose={()=>setPaySetupModal(false)} />

        {/* ══ DELETE ACCOUNT CONFIRMATION MODAL ══ */}
        <Modal visible={deleteConfirmVisible} transparent animationType="fade">
          <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.82)', justifyContent:'center', alignItems:'center', padding:28 }}>
            <Animated.View style={{
              backgroundColor: C.charcoal, borderRadius: 24, padding: 28, width: '100%',
              borderWidth: 1.5, borderColor: C.red + '66',
              shadowColor: C.red, shadowOpacity: 0.35, shadowRadius: 24, elevation: 20,
            }}>
              {/* Warning icon */}
              <View style={{ alignItems:'center', marginBottom: 18 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,76,76,0.15)', borderWidth: 2, borderColor: C.red + '55', justifyContent:'center', alignItems:'center' }}>
                  <Text style={{ fontSize: 34 }}>⚠️</Text>
                </View>
              </View>
              {/* Title */}
              <Text style={{ color: C.red, fontWeight: '900', fontSize: 20, textAlign:'center', marginBottom: 10, letterSpacing: 0.5 }}>
                {t.deleteAcc}
              </Text>
              {/* Warning text */}
              <Text style={{ color: C.offWhite, fontSize: 13, lineHeight: 21, textAlign:'center', marginBottom: 8 }}>
                {t.deleteAccWarning || 'This will permanently delete your account, all trip history, and remove your data from MotoLink.'}
              </Text>
              <Text style={{ color: C.red, fontSize: 12, fontWeight: '700', textAlign:'center', marginBottom: 24, letterSpacing: 0.3 }}>
                ⚠️ {t.deleteAccIrreversible || 'This action cannot be undone.'}
              </Text>
              {/* Buttons */}
              <TouchableOpacity
                onPress={executeDeleteAccount}
                style={{ backgroundColor: C.red, borderRadius: 14, paddingVertical: 15, alignItems:'center', marginBottom: 12 }}>
                <Text style={{ color: C.white, fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }}>
                  🗑️ {t.deleteAccConfirm || 'Yes, Delete My Account'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDeleteConfirmVisible(false)}
                style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, paddingVertical: 15, alignItems:'center', borderWidth: 1, borderColor: C.border }}>
                <Text style={{ color: C.offWhite, fontWeight: '700', fontSize: 15 }}>
                  ← {t.cancel}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </Modal>

        {/* ══ TERMS OF SERVICE MODAL ══ */}
        <Modal visible={showTOS} animationType="slide" transparent={false}>
          <View style={{ flex:1, backgroundColor: C.black }}>
            <View style={{ backgroundColor: C.charcoal, paddingTop: Platform.OS==='android'?(StatusBar.currentHeight||0)+8:44, paddingBottom:14, paddingHorizontal:20, borderBottomWidth:1, borderBottomColor:C.border }}>
              <View style={{ alignItems:'center', marginBottom:6 }}>
                <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
              </View>
              <Text style={{ color:C.gold, fontWeight:'900', fontSize:18, textAlign:'center', letterSpacing:1 }}>{t.tos_title}</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding:20, paddingBottom:40 }} showsVerticalScrollIndicator={false}>
              {[
                { title: t.tos_s1_title, body: t.tos_s1_body },
                { title: t.tos_s2_title, body: t.tos_s2_body },
                { title: t.tos_s3_title, body: t.tos_s3_body },
                { title: t.tos_s4_title, body: t.tos_s4_body },
                { title: t.tos_s5_title, body: t.tos_s5_body },
                { title: t.tos_s6_title, body: t.tos_s6_body },
                { title: t.tos_s7_title, body: t.tos_s7_body },
              ].map((sec, i) => (
                <View key={i}>
                  <Text style={{ color:C.gold, fontWeight:'900', fontSize:15, marginBottom:8 }}>{sec.title}</Text>
                  <Text style={{ color:C.offWhite, fontSize:13, lineHeight:21, marginBottom:16 }}>{sec.body}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={{ padding:20, borderTopWidth:1, borderTopColor:C.border, backgroundColor:C.charcoal }}>
              <TouchableOpacity
                style={[styles.mainBtn, { marginBottom:10 }]}
                onPress={async () => {
                  await AsyncStorage.setItem('@motolink_tos_accepted', '1');
                  setTosAccepted(true);
                  setShowTOS(false);
                  if (state.role === 'driver' && !state.profile?.id_submitted) {
                    setIdScanMandatory(true);
                    setTimeout(() => setIdScanModal(true), 300);
                  }
                }}>
                <Text style={styles.mainBtnTxt}>{t.tos_agree}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowPrivacy(true)} style={{ alignItems:'center', paddingVertical:8 }}>
                <Text style={{ color:C.gray, fontSize:12, textDecorationLine:'underline' }}>{t.tos_readPrivacy}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* ══ PRIVACY POLICY MODAL ══ */}
        <Modal visible={showPrivacy} animationType="slide" transparent={false}>
          <View style={{ flex:1, backgroundColor:C.black }}>
            <View style={{ backgroundColor:C.charcoal, paddingTop:Platform.OS==='android'?(StatusBar.currentHeight||0)+8:44, paddingBottom:14, paddingHorizontal:20, borderBottomWidth:1, borderBottomColor:C.border, flexDirection:'row', alignItems:'center' }}>
              <TouchableOpacity onPress={() => setShowPrivacy(false)} style={{ marginRight:12 }}>
                <Text style={{ color:C.gold, fontSize:18 }}>←</Text>
              </TouchableOpacity>
              <Text style={{ color:C.gold, fontWeight:'900', fontSize:16, flex:1 }}>{t.privacy_title}</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding:20, paddingBottom:40 }}>
              <Text style={{ color:C.offWhite, fontSize:13, lineHeight:22, marginBottom:16 }}>{t.privacy_updated}</Text>
              {[
                { title: t.privacy_s1_title, body: t.privacy_s1_body },
                { title: t.privacy_s2_title, body: t.privacy_s2_body },
                { title: t.privacy_s3_title, body: t.privacy_s3_body },
                { title: t.privacy_s4_title, body: t.privacy_s4_body },
                { title: t.privacy_s5_title, body: t.privacy_s5_body },
              ].map((sec, i) => (
                <View key={i}>
                  <Text style={{ color:C.gold, fontWeight:'900', fontSize:14, marginBottom:8 }}>{sec.title}</Text>
                  <Text style={{ color:C.offWhite, fontSize:13, lineHeight:21, marginBottom:16 }}>{sec.body}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </Modal>

        {/* ══ FAVORITES MODAL ══ */}
        <Modal visible={showFavorites} animationType="slide" transparent>
          <View style={styles.modalBg}>
            <View style={[styles.glassModal, { maxHeight: height*0.85 }]}>
              <TouchableOpacity onPress={() => { setShowFavorites(false); setFavEditKey(null); setFavEditMode(null); setFavManualText(''); setFavSearchResults([]); setFavSearchQuery(''); }} style={{ position:'absolute', top:12, right:12, width:32, height:32, borderRadius:16, backgroundColor:'rgba(255,255,255,0.08)', alignItems:'center', justifyContent:'center', zIndex:10 }}>
                <Text style={{ color:C.gray, fontWeight:'700' }}>✕</Text>
              </TouchableOpacity>
              <Text style={{ color:C.gold, fontWeight:'900', fontSize:17, marginBottom:4, letterSpacing:1 }}>{t.savedPlaces}</Text>
              <Text style={{ color:C.grayDark, fontSize:11, marginBottom:14 }}>{t.searchHint || 'Tap GO to use, or edit any place'}</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {[
                  {key:'home', label:'🏡 ' + (t.home || 'Home'), icon:'🏡'},
                  {key:'work', label:'💼 ' + (t.work || 'Work'), icon:'💼'},
                  {key:'fav1', label:'⭐ ' + (t.fav1 || 'Favourite 1'), icon:'⭐'},
                  {key:'fav2', label:'⭐ ' + (t.fav2 || 'Favourite 2'), icon:'⭐'},
                ].map(fav => {
                  const saved = state.favorites?.find(f => f.key === fav.key);
                  const isEditing = favEditKey === fav.key;
                  return (
                    <View key={fav.key} style={{ backgroundColor:C.card2, borderRadius:16, padding:14, marginBottom:10, borderWidth:1, borderColor: isEditing ? C.gold : C.border }}>
                      {/* Header row */}
                      <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom: isEditing ? 12 : 0 }}>
                        <View style={{ flex:1 }}>
                          <Text style={{ color:C.gold, fontWeight:'800', fontSize:13 }}>{fav.label}</Text>
                          {!isEditing && (
                            <Text style={{ color: saved ? C.offWhite : C.grayDark, fontSize:12, marginTop:3 }} numberOfLines={1}>
                              {saved?.address || t.noAddress}
                            </Text>
                          )}
                        </View>
                        <View style={{ flexDirection:'row', gap:6, flexShrink:0 }}>
                          {/* GO button */}
                          {saved && !isEditing && (
                            <TouchableOpacity
                              onPress={() => {
                                setSearchQuery(saved.address);
                                handleSearchInput(saved.address);
                                setShowFavorites(false);
                                setFavEditKey(null);
                              }}
                              style={{ backgroundColor:C.goldDim, borderRadius:10, paddingHorizontal:10, paddingVertical:6, borderWidth:1, borderColor:C.gold }}>
                              <Text style={{ color:C.gold, fontWeight:'700', fontSize:11 }}>GO →</Text>
                            </TouchableOpacity>
                          )}
                          {/* Edit toggle */}
                          {!isEditing ? (
                            <TouchableOpacity
                              onPress={() => { setFavEditKey(fav.key); setFavEditMode(null); setFavManualText(saved?.address || ''); setFavSearchResults([]); setFavSearchQuery(''); }}
                              style={{ backgroundColor:'rgba(255,255,255,0.07)', borderRadius:10, paddingHorizontal:10, paddingVertical:6, borderWidth:1, borderColor:C.borderFaint }}>
                              <Text style={{ color:C.gray, fontWeight:'700', fontSize:11 }}>✏️</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              onPress={() => { setFavEditKey(null); setFavEditMode(null); setFavManualText(''); setFavSearchResults([]); setFavSearchQuery(''); }}
                              style={{ backgroundColor:'rgba(255,76,76,0.1)', borderRadius:10, paddingHorizontal:10, paddingVertical:6, borderWidth:1, borderColor:C.red+'44' }}>
                              <Text style={{ color:C.red, fontWeight:'700', fontSize:11 }}>✕</Text>
                            </TouchableOpacity>
                          )}
                          {/* Delete */}
                          {saved && !isEditing && (
                            <TouchableOpacity
                              onPress={() => {
                                const updated = (state.favorites||[]).filter(f=>f.key!==fav.key);
                                dispatch({ type:'SET_FAVORITES', p:updated });
                                saveFavorites(updated);
                                showBanner('🗑️', t.deleteOk || 'Deleted.', 'success');
                              }}
                              style={{ backgroundColor:'rgba(255,76,76,0.1)', borderRadius:10, paddingHorizontal:10, paddingVertical:6, borderWidth:1, borderColor:C.red+'44' }}>
                              <Text style={{ color:C.red, fontWeight:'700', fontSize:11 }}>🗑️</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {/* EDIT PANEL */}
                      {isEditing && (
                        <View style={{ gap:8 }}>
                          {/* Mode selector */}
                          {!favEditMode && (
                            <View style={{ gap:8 }}>
                              <TouchableOpacity
                                onPress={async () => {
                                  setFavEditMode('current');
                                  setFavCurrentResolvedName('');
                                  if (state.myLocation) {
                                    setFavCurrentResolving(true);
                                    try {
                                      const resolved = await reverseGeocode(state.myLocation.latitude, state.myLocation.longitude);
                                      setFavCurrentResolvedName(resolved || '');
                                    } catch { setFavCurrentResolvedName(''); }
                                    setFavCurrentResolving(false);
                                  }
                                }}
                                style={{ backgroundColor:C.goldDim, borderRadius:12, padding:12, borderWidth:1, borderColor:C.gold, flexDirection:'row', alignItems:'center', gap:10 }}>
                                <Text style={{ fontSize:18 }}>📍</Text>
                                <View style={{ flex:1 }}>
                                  <Text style={{ color:C.gold, fontWeight:'800', fontSize:13 }}>Use Current Location</Text>
                                  <Text style={{ color:C.gray, fontSize:11 }}>{state.myLocation ? 'GPS ready' : 'Enable GPS first'}</Text>
                                </View>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => setFavEditMode('manual')}
                                style={{ backgroundColor:'rgba(255,255,255,0.04)', borderRadius:12, padding:12, borderWidth:1, borderColor:C.borderFaint, flexDirection:'row', alignItems:'center', gap:10 }}>
                                <Text style={{ fontSize:18 }}>✏️</Text>
                                <View style={{ flex:1 }}>
                                  <Text style={{ color:C.offWhite, fontWeight:'700', fontSize:13 }}>{t.manualEntry}</Text>
                                  <Text style={{ color:C.gray, fontSize:11 }}>{t.manualAddressHint}</Text>
                                </View>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => setFavEditMode('search')}
                                style={{ backgroundColor:'rgba(255,255,255,0.04)', borderRadius:12, padding:12, borderWidth:1, borderColor:C.borderFaint, flexDirection:'row', alignItems:'center', gap:10 }}>
                                <Text style={{ fontSize:18 }}>🔍</Text>
                                <View style={{ flex:1 }}>
                                  <Text style={{ color:C.offWhite, fontWeight:'700', fontSize:13 }}>{t.pickFromSearch}</Text>
                                  <Text style={{ color:C.gray, fontSize:11 }}>Search Kigali places</Text>
                                </View>
                              </TouchableOpacity>
                            </View>
                          )}

                          {/* CURRENT LOCATION mode */}
                          {favEditMode === 'current' && (
                            <View style={{ gap:8 }}>
                              {/* Resolved place name — shown after geocoding */}
                              <View style={{ backgroundColor:'rgba(212,175,55,0.08)', borderRadius:12, padding:12, borderWidth:1, borderColor: favCurrentResolvedName && !favCurrentResolvedName.includes(',') ? C.border : C.gold }}>
                                <Text style={{ color:C.gold, fontSize:11, fontWeight:'700', marginBottom:4 }}>📍 Place Name (will be saved)</Text>
                                {favCurrentResolving ? (
                                  <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                                    <ActivityIndicator color={C.gold} size="small" />
                                    <Text style={{ color:C.gray, fontSize:12 }}>Looking up address...</Text>
                                  </View>
                                ) : (
                                  <TextInput
                                    style={{ color:C.white, fontSize:13, fontWeight:'700', padding:0, margin:0 }}
                                    value={favCurrentResolvedName}
                                    onChangeText={setFavCurrentResolvedName}
                                    placeholder="Address name here..."
                                    placeholderTextColor={C.grayDark}
                                  />
                                )}
                              </View>
                              {/* GPS coords shown as secondary info only */}
                              {state.myLocation && (
                                <Text style={{ color:C.grayDark, fontSize:10, textAlign:'center' }}>
                                  GPS: {state.myLocation.latitude.toFixed(5)}, {state.myLocation.longitude.toFixed(5)}
                                </Text>
                              )}
                              <View style={{ flexDirection:'row', gap:8 }}>
                                <TouchableOpacity
                                  onPress={() => { setFavEditMode(null); setFavCurrentResolvedName(''); }}
                                  style={{ flex:1, backgroundColor:'rgba(255,255,255,0.05)', borderRadius:12, padding:12, borderWidth:1, borderColor:C.borderFaint, alignItems:'center' }}>
                                  <Text style={{ color:C.gray, fontSize:12 }}>← Back</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  disabled={favCurrentResolving || !state.myLocation}
                                  onPress={async () => {
                                    if (!state.myLocation) { showBanner('📍', 'Enable GPS first', 'warning'); return; }
                                    // Use already-resolved name or re-resolve now as fallback
                                    let addr = favCurrentResolvedName?.trim();
                                    if (!addr) {
                                      setFavCurrentResolving(true);
                                      addr = await reverseGeocode(state.myLocation.latitude, state.myLocation.longitude).catch(() => '');
                                      setFavCurrentResolving(false);
                                    }
                                    // Final fallback only if every geocode attempt gave nothing meaningful
                                    if (!addr || addr.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/)) {
                                      addr = addr || `${state.myLocation.latitude.toFixed(4)}, ${state.myLocation.longitude.toFixed(4)}`;
                                    }
                                    const newFav = { key: fav.key, label: fav.label, address: addr, lat: state.myLocation.latitude, lng: state.myLocation.longitude };
                                    const updated = [...(state.favorites||[]).filter(f=>f.key!==fav.key), newFav];
                                    dispatch({ type:'SET_FAVORITES', p:updated });
                                    saveFavorites(updated);
                                    showBanner('⭐', `${fav.label} ${t.savedOk}`, 'success');
                                    setFavEditKey(null); setFavEditMode(null); setFavCurrentResolvedName('');
                                  }}
                                  style={{ flex:2, backgroundColor: favCurrentResolving || !state.myLocation ? C.border : C.gold, borderRadius:12, padding:12, alignItems:'center' }}>
                                  {favCurrentResolving
                                    ? <ActivityIndicator color={C.black} size="small" />
                                    : <Text style={{ color:C.black, fontWeight:'900', fontSize:13 }}>{t.savePlace} ✓</Text>}
                                </TouchableOpacity>
                              </View>
                            </View>
                          )}

                          {/* MANUAL ENTRY mode */}
                          {favEditMode === 'manual' && (
                            <View style={{ gap:8 }}>
                              <Text style={{ color:C.gray, fontSize:11, fontWeight:'700', letterSpacing:0.5 }}>{t.manualAddressHint}</Text>
                              <TextInput
                                style={[styles.input, { paddingVertical:14 }]}
                                placeholder="e.g. Kigali Heights, Remera"
                                placeholderTextColor={C.grayDark}
                                value={favManualText}
                                onChangeText={setFavManualText}
                                autoFocus
                                returnKeyType="done"
                              />
                              <View style={{ flexDirection:'row', gap:8 }}>
                                <TouchableOpacity
                                  onPress={() => { setFavEditMode(null); }}
                                  style={{ flex:1, backgroundColor:'rgba(255,255,255,0.05)', borderRadius:12, padding:12, borderWidth:1, borderColor:C.borderFaint, alignItems:'center' }}>
                                  <Text style={{ color:C.gray, fontSize:12 }}>← Back</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => {
                                    if (!favManualText.trim()) { showBanner('⚠️', 'Enter an address', 'warning'); return; }
                                    const newFav = { key: fav.key, label: fav.label, address: favManualText.trim(), lat: state.myLocation?.latitude, lng: state.myLocation?.longitude };
                                    const updated = [...(state.favorites||[]).filter(f=>f.key!==fav.key), newFav];
                                    dispatch({ type:'SET_FAVORITES', p:updated });
                                    saveFavorites(updated);
                                    showBanner('⭐', `${fav.label} ${t.savedOk}`, 'success');
                                    setFavEditKey(null); setFavEditMode(null); setFavManualText('');
                                  }}
                                  style={{ flex:2, backgroundColor:C.gold, borderRadius:12, padding:12, alignItems:'center' }}>
                                  <Text style={{ color:C.black, fontWeight:'900', fontSize:13 }}>{t.savePlace} ✓</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          )}

                          {/* SEARCH PICK mode */}
                          {favEditMode === 'search' && (
                            <View style={{ gap:8 }}>
                              <TextInput
                                style={[styles.input, { paddingVertical:14 }]}
                                placeholder={t.searchPlaceholder || 'Search Kigali places...'}
                                placeholderTextColor={C.grayDark}
                                value={favSearchQuery}
                                onChangeText={async (text) => {
                                  setFavSearchQuery(text);
                                  if (text.length < 2) { setFavSearchResults([]); return; }
                                  try {
                                    const r = await smartSearch(text, state.myLocation?.latitude || -1.9441, state.myLocation?.longitude || 30.0619);
                                    setFavSearchResults((r||[]).slice(0,5));
                                  } catch { setFavSearchResults([]); }
                                }}
                                autoFocus
                              />
                              {favSearchResults.length > 0 && (
                                <View style={{ backgroundColor:C.card2, borderRadius:12, borderWidth:1, borderColor:C.border, overflow:'hidden' }}>
                                  {favSearchResults.map((res, ri) => {
                                    const mainText = buildLabel(res);
                                    const fullName = res.display_name || res.description || mainText;
                                    const secondaryText = res.structured?.secondary_text
                                      || (fullName.includes(',') ? fullName.split(',').slice(1,3).join(',').trim() : '');
                                    const resLat = parseFloat(res.lat);
                                    const resLng = parseFloat(res.lon);
                                    return (
                                      <TouchableOpacity key={ri}
                                        onPress={() => {
                                          const addr = fullName || mainText || favSearchQuery;
                                          const newFav = { key: fav.key, label: fav.label, address: addr, lat: resLat, lng: resLng };
                                          const updated = [...(state.favorites||[]).filter(f=>f.key!==fav.key), newFav];
                                          dispatch({ type:'SET_FAVORITES', p:updated });
                                          saveFavorites(updated);
                                          showBanner('⭐', `${fav.label} ${t.savedOk}`, 'success');
                                          setFavEditKey(null); setFavEditMode(null); setFavSearchResults([]); setFavSearchQuery('');
                                        }}
                                        style={{ padding:12, borderBottomWidth: ri < favSearchResults.length-1 ? 1 : 0, borderBottomColor:C.borderFaint, flexDirection:'row', alignItems:'center', gap:10 }}>
                                        <Text style={{ fontSize:16 }}>{res._isManual ? '✏️' : '📍'}</Text>
                                        <View style={{ flex:1 }}>
                                          <Text style={{ color: res._isManual ? C.gold : C.white, fontSize:13, fontWeight:'700' }} numberOfLines={1}>{mainText || favSearchQuery}</Text>
                                          {secondaryText ? <Text style={{ color:C.gray, fontSize:11, marginTop:2 }} numberOfLines={1}>{secondaryText}</Text> : null}
                                        </View>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              )}
                              <TouchableOpacity
                                onPress={() => { setFavEditMode(null); setFavSearchResults([]); setFavSearchQuery(''); }}
                                style={{ backgroundColor:'rgba(255,255,255,0.05)', borderRadius:12, padding:12, borderWidth:1, borderColor:C.borderFaint, alignItems:'center' }}>
                                <Text style={{ color:C.gray, fontSize:12 }}>← Back</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
                {/* Recent searches as quick destinations */}
                {state.favorites?.filter(f=>f.key.startsWith('recent')).length > 0 && (
                  <>
                    <Text style={{ color:C.gray, fontSize:11, fontWeight:'700', letterSpacing:1, marginBottom:8, marginTop:4 }}>RECENT</Text>
                    {state.favorites.filter(f=>f.key.startsWith('recent')).slice(0,5).map((fav,i) => (
                      <TouchableOpacity key={i} onPress={() => { setSearchQuery(fav.address); handleSearchInput(fav.address); setShowFavorites(false); }}
                        style={{ backgroundColor:C.glassMid, borderRadius:12, padding:12, marginBottom:8, flexDirection:'row', alignItems:'center', gap:10 }}>
                        <Text style={{ fontSize:16 }}>🕐</Text>
                        <Text style={{ color:C.offWhite, fontSize:12, flex:1 }} numberOfLines={1}>{fav.address}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ══ TRIP SHARING MODAL ══ */}
        <Modal visible={showShareTrip} animationType="slide" transparent>
          <View style={styles.modalBg}>
            <View style={[styles.glassModal, { padding:24 }]}>
              <TouchableOpacity onPress={() => setShowShareTrip(false)} style={{ position:'absolute', top:12, right:12, width:32, height:32, borderRadius:16, backgroundColor:'rgba(255,255,255,0.08)', alignItems:'center', justifyContent:'center', zIndex:10 }}>
                <Text style={{ color:C.gray, fontWeight:'700' }}>✕</Text>
              </TouchableOpacity>
              <Text style={{ color:C.gold, fontWeight:'900', fontSize:17, marginBottom:4 }}>📤 Share Live Trip</Text>
              <Text style={{ color:C.gray, fontSize:12, marginBottom:14, lineHeight:18 }}>Anyone with the link can track your driver's live location for safety.</Text>

              {/* Trip summary card */}
              {AT && (
                <View style={{ backgroundColor:C.card2, borderRadius:12, padding:12, marginBottom:14, borderWidth:1, borderColor:C.border }}>
                  <View style={{ flexDirection:'row', alignItems:'center', gap:6, marginBottom:4 }}>
                    <View style={{ width:8, height:8, borderRadius:4, backgroundColor:C.gold }} />
                    <Text style={{ color:C.offWhite, fontSize:12, flex:1 }} numberOfLines={1}>{AT.pickup_address}</Text>
                  </View>
                  <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                    <View style={{ width:8, height:8, borderRadius:4, backgroundColor:C.green }} />
                    <Text style={{ color:C.white, fontWeight:'700', fontSize:12, flex:1 }} numberOfLines={1}>{AT.destination_address}</Text>
                  </View>
                  <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop:8 }}>
                    <Text style={{ color:C.gold, fontWeight:'900', fontSize:15 }}>{fmtFRW(AT.price)}</Text>
                    <Text style={{ color:C.gray, fontSize:11 }}>ID: {AT.id?.slice(-6)?.toUpperCase()}</Text>
                  </View>
                </View>
              )}

              {/* Tracking link preview */}
              {AT && (
                <View style={{ backgroundColor:'rgba(52,152,219,0.08)', borderRadius:10, padding:10, marginBottom:14, borderWidth:1, borderColor:C.blue+'44' }}>
                  <Text style={{ color:C.blue, fontSize:10, fontWeight:'700', marginBottom:2 }}>🔗 TRACKING LINK</Text>
                  <Text style={{ color:C.offWhite, fontSize:11 }} numberOfLines={1} selectable>
                    motolinkt.netlify.app?tripId={AT.id}
                  </Text>
                </View>
              )}

              {/* Native system share — covers WhatsApp, Telegram, Gmail, etc. */}
              <TouchableOpacity
                style={[styles.mainBtn, { marginBottom:10 }]}
                onPress={() => { handleShareLiveTrip(AT?.id); setShowShareTrip(false); }}>
                <Text style={[styles.mainBtnTxt]}>📤 Share via Any App</Text>
              </TouchableOpacity>

              {/* WhatsApp quick-share */}
              <TouchableOpacity
                style={[styles.mainBtn, { marginBottom:10, backgroundColor:'#25D366' }]}
                onPress={() => {
                  const trackingUrl = `https://motolinkt.netlify.app?tripId=${AT?.id}`;
                  const msg = AT
                    ? `🏍️ I'm on a MotoLink ride!\n📍 From: ${AT.pickup_address}\n🎯 To: ${AT.destination_address}\n💰 ${fmtFRW(AT.price)}\n\n🔗 Track my live trip:\n${trackingUrl}\n\nStay safe! 🙏`
                    : `🏍️ I'm using MotoLink moto-taxi in Kigali. Download the app!`;
                  Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`).catch(() => showBanner('❌', 'WhatsApp not installed', 'error'));
                  setShowShareTrip(false);
                }}>
                <Text style={[styles.mainBtnTxt, { color:C.white }]}>💚 Share via WhatsApp</Text>
              </TouchableOpacity>

              {/* SMS fallback */}
              <TouchableOpacity
                style={[styles.outlineBtn]}
                onPress={() => {
                  const trackingUrl = `https://motolinkt.netlify.app?tripId=${AT?.id}`;
                  const msg = AT
                    ? `🏍️ MotoLink ride: ${AT.pickup_address} → ${AT.destination_address} | ${fmtFRW(AT.price)}\n🔗 Track: ${trackingUrl}`
                    : `🏍️ I'm using MotoLink moto-taxi in Kigali!`;
                  Linking.openURL(`sms:?body=${encodeURIComponent(msg)}`).catch(() => {});
                  setShowShareTrip(false);
                }}>
                <Text style={styles.outlineBtnTxt}>💬 Share via SMS</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Profile modal */}
        {/* ══════════════════════════════════════════
            DRIVER ID VERIFICATION MODAL
        ══════════════════════════════════════════ */}
        <Modal visible={idScanModal} animationType="slide" transparent>
          <View style={styles.modalBg}>
            <ScrollView contentContainerStyle={[styles.glassModal, { padding:20 }]} keyboardShouldPersistTaps="handled">
              {/* Header */}
              {!idScanMandatory && (
                <TouchableOpacity onPress={() => setIdScanModal(false)} style={{ position:'absolute', top:12, right:12, zIndex:10, width:32, height:32, borderRadius:16, backgroundColor:'rgba(255,255,255,0.08)', alignItems:'center', justifyContent:'center' }}>
                  <Text style={{ color:C.gray, fontWeight:'700' }}>✕</Text>
                </TouchableOpacity>
              )}
              <Text style={{ color:C.gold, fontWeight:'900', fontSize:18, marginBottom:4 }}>🪪 Driver Verification</Text>
              <Text style={{ color:C.gray, fontSize:12, marginBottom:18, lineHeight:18 }}>
                {idScanMandatory
                  ? "One last step before you start driving — scan your National ID and Driver's Permit so passengers can ride with confidence. Your profile photo isn't required now; you can add it anytime from Settings."
                  : "MotoLink verifies every driver's identity for passenger safety. Scan your National ID and Driver's Permit — details are auto-filled where possible."}
              </Text>

              {/* Profile photo */}
              <Text style={{ color:C.offWhite, fontWeight:'800', fontSize:13, marginBottom:8 }}>📸 Profile Photo {idScanMandatory && <Text style={{ color:C.gray, fontWeight:'500', fontSize:11 }}>(optional — add anytime)</Text>}</Text>
              <TouchableOpacity onPress={() => captureIdDocument('profile')} style={{ alignItems:'center', marginBottom:16 }}>
                {idScanData.profilePhotoUri ? (
                  <Image source={{ uri: idScanData.profilePhotoUri }} style={{ width:90, height:90, borderRadius:45, borderWidth:3, borderColor:C.gold }} />
                ) : (
                  <View style={{ width:90, height:90, borderRadius:45, backgroundColor:C.card2, borderWidth:2, borderColor:C.border, alignItems:'center', justifyContent:'center' }}>
                    <Text style={{ fontSize:34 }}>👤</Text>
                    <Text style={{ color:C.gray, fontSize:10, marginTop:4 }}>Tap to add</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* National ID scan */}
              <Text style={{ color:C.offWhite, fontWeight:'800', fontSize:13, marginBottom:8 }}>🪪 National ID Card</Text>
              <TouchableOpacity onPress={() => captureIdDocument('id')}
                style={{ backgroundColor:C.card2, borderRadius:12, borderWidth:2, borderColor: idScanData.idPhotoUri ? C.green : C.gold, borderStyle:'dashed', height:110, alignItems:'center', justifyContent:'center', marginBottom:12, overflow:'hidden' }}>
                {idScanData.idPhotoUri ? (
                  <Image source={{ uri: idScanData.idPhotoUri }} style={{ width:'100%', height:'100%', borderRadius:10 }} resizeMode="cover" />
                ) : (
                  <>
                    <Text style={{ fontSize:32, marginBottom:6 }}>📷</Text>
                    <Text style={{ color:C.gold, fontWeight:'700', fontSize:13 }}>Scan National ID</Text>
                    <Text style={{ color:C.gray, fontSize:11 }}>Front side — details auto-fill</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Auto-filled / manual fields */}
              <View style={{ gap:10, marginBottom:12 }}>
                {[
                  { label:'Full Name (as on ID)', key:'fullName', placeholder:'e.g. UWIMANA Jean Paul' },
                  { label:'ID Number', key:'idNumber', placeholder:'e.g. 1 1998 7 123456 7 8' },
                  { label:'Date of Birth', key:'dob', placeholder:'DD/MM/YYYY' },
                  { label:'District of Origin', key:'origin', placeholder:'e.g. Kicukiro, Kigali' },
                ].map(({ label, key, placeholder }) => (
                  <View key={key}>
                    <Text style={{ color:C.gray, fontSize:11, marginBottom:3 }}>{label}</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor:C.card2, borderWidth:1, borderColor: idScanData[key] ? C.green+'88' : C.border }]}
                      placeholder={placeholder} placeholderTextColor={C.grayDark}
                      value={idScanData[key]}
                      onChangeText={val => setIdScanData(prev => ({ ...prev, [key]: val }))}
                    />
                  </View>
                ))}
              </View>

              {/* Driver's Permit scan */}
              <Text style={{ color:C.offWhite, fontWeight:'800', fontSize:13, marginBottom:8, marginTop:4 }}>📄 Driver's Permit / License</Text>
              <TouchableOpacity onPress={() => captureIdDocument('permit')}
                style={{ backgroundColor:C.card2, borderRadius:12, borderWidth:2, borderColor: idScanData.permitPhotoUri ? C.green : C.border, borderStyle:'dashed', height:90, alignItems:'center', justifyContent:'center', marginBottom:20, overflow:'hidden' }}>
                {idScanData.permitPhotoUri ? (
                  <Image source={{ uri: idScanData.permitPhotoUri }} style={{ width:'100%', height:'100%', borderRadius:10 }} resizeMode="cover" />
                ) : (
                  <>
                    <Text style={{ fontSize:28, marginBottom:4 }}>📷</Text>
                    <Text style={{ color:C.offWhite, fontWeight:'700', fontSize:12 }}>Scan Driver's Permit</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Verification notice */}
              <View style={{ backgroundColor:'rgba(0,217,126,0.08)', borderRadius:12, padding:12, borderWidth:1, borderColor:C.green+'44', marginBottom:16 }}>
                <Text style={{ color:C.green, fontSize:11, lineHeight:16 }}>
                  🔒 Your documents are encrypted and stored securely. They are only used to verify your identity and are reviewed by MotoLink staff within 24 hours.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.mainBtn, { opacity: (idScanData.idNumber && idScanData.fullName && (!idScanMandatory || (idScanData.idPhotoUri && idScanData.permitPhotoUri))) ? 1 : 0.5 }]}
                disabled={!idScanData.idNumber || !idScanData.fullName || (idScanMandatory && (!idScanData.idPhotoUri || !idScanData.permitPhotoUri))}
                onPress={submitIdVerification}>
                <Text style={styles.mainBtnTxt}>📋 Submit for Verification</Text>
              </TouchableOpacity>
              {idScanMandatory && (!idScanData.idPhotoUri || !idScanData.permitPhotoUri) && (
                <Text style={{ color:C.gold, fontSize:11, textAlign:'center', marginTop:8 }}>
                  📷 Scan both your National ID and Driver's Permit to continue
                </Text>
              )}
              <Text style={{ color:C.grayDark, fontSize:10, textAlign:'center', marginTop:10 }}>
                You can still drive while under review. Full verification unlocks priority ride matching.
              </Text>
            </ScrollView>
          </View>
        </Modal>

        <Modal visible={profileModal} animationType="fade" transparent>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding': 'height'} style={ { flex: 1 }}>
            <View style={styles.modalBg}>
              <ScrollView contentContainerStyle={styles.glassModal} keyboardShouldPersistTaps="handled">
                {/* ── UPGRADE: ❌ close button at top-right ── */}
                <TouchableOpacity
                  onPress={() => setProfileModal(false)}
                  style={ { position: 'absolute',
                    top: 12,
                    right: 12,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10 }}
                  >
                  <Text style={ { color: C.gray,
                    fontSize: 16,
                    fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
                <View style={ { alignItems: 'center',
                  marginBottom: 16 }}>
                  <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
                  <Text style={[styles.splashTitle,
                    { fontSize: 20,
                      marginBottom: 4 }]}>{t.settings}</Text>
                </View>
                <View style={ { alignItems: 'center',
                  marginBottom: 20 }}>
                  {/* Tappable avatar — opens picker and saves immediately */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={async () => {
                      // Web: file input; native: ImagePicker gallery
                      const pickAndUpload = async (uri, base64) => {
                        if (!uri) return;
                        showBanner('⬆️', 'Uploading profile photo...', 'info');
                        try {
                          const res = await fetch(uri);
                          const blob = await res.blob();
                          const arr = await blob.arrayBuffer();
                          const path = `drivers/${state.session?.user?.id}/profile_${Date.now()}.jpg`;
                          await supabase.storage.from('verification-docs').upload(path, arr, { upsert: true });
                          const { data: urlData } = supabase.storage.from('verification-docs').getPublicUrl(path);
                          const url = urlData?.publicUrl;
                          if (url) {
                            await supabase.from('profiles').update({ avatar_url: url }).eq('id', state.session?.user?.id);
                            dispatch({ type:'SET_PROFILE', p:{ ...state.profile, avatar_url: url, avatar: url }});
                            showBanner('✅', 'Profile photo updated!', 'success');
                          }
                        } catch { showBanner('⚠️', 'Upload failed. Try again.', 'error'); }
                      };
                      if (Platform.OS === 'web' || !ImagePicker) {
                        if (typeof document === 'undefined') return;
                        const inp = document.createElement('input');
                        inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
                        inp.onchange = (e) => {
                          const file = e.target.files?.[0]; document.body.removeChild(inp);
                          if (!file) return;
                          const r = new FileReader();
                          r.onload = () => pickAndUpload(r.result, r.result.split(',')[1]);
                          r.readAsDataURL(file);
                        };
                        document.body.appendChild(inp); inp.click();
                      } else {
                        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                        if (status !== 'granted') { showBanner('📷', 'Gallery permission needed.', 'error'); return; }
                        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85, base64: false });
                        if (!res.canceled && res.assets?.[0]) await pickAndUpload(res.assets[0].uri, null);
                      }
                    }}
                  >
                    <View style={[styles.avatarWrap, { width: 80, height: 80, borderRadius: 40 }]}>
                      {(state.profile?.avatar_url || state.profile?.avatar)
                        ? <Image source={{ uri: state.profile.avatar_url || state.profile.avatar }} style={styles.avatarImg} />
                        : <Text style={[styles.avatarTxt, { fontSize: 26 }]}>{state.profile?.name?.substring(0, 2).toUpperCase() || 'ME'}</Text>}
                    </View>
                    {/* Camera badge */}
                    <View style={{ position:'absolute', bottom:0, right:0, backgroundColor:C.gold, width:26, height:26, borderRadius:13, justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:C.black }}>
                      <Text style={{ fontSize:13 }}>📷</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={{ color:C.gray, fontSize:10, marginTop:6 }}>Tap to change photo</Text>
                  <View style={ { flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 8,
                    gap: 6 }}>
                    <StarRow rating={state.profile?.rating || 5.0} size={18} />
                    <Text style={ { color: C.gold,
                      fontWeight: '800',
                      fontSize: 15 }}>{(state.profile?.rating || 5.0).toFixed(1)}</Text>
                    <Text style={ { color: C.gray,
                      fontSize: 11 }}>({state.profile?.total_ratings || 0})</Text>
                  </View>
                </View>
                <View style={styles.inputWrap}>
                  <Text style={styles.inputLabel}>{t.name}</Text>
                  <TextInput style={styles.input} placeholderTextColor={C.grayDark} value={state.profile?.name} onChangeText={txt=>dispatch( { type: 'SET_PROFILE', p: { ...state.profile, name: txt }})} />
                </View>
                {state.role === 'driver' && (
                  <>
                    <View style={styles.inputWrap}>
                      <Text style={styles.inputLabel}>{t.fareLabel} — Plate</Text>
                      <TextInput style={styles.input} placeholder="RE 123 A" placeholderTextColor={C.grayDark} value={state.profile?.plate} onChangeText={txt=>dispatch( { type: 'SET_PROFILE', p: { ...state.profile, plate: txt }})} />
                    </View>

                    {/* ── Driver ID / Permit Verification ── */}
                    <TouchableOpacity
                      onPress={() => { setProfileModal(false); setTimeout(() => setIdScanModal(true), 300); }}
                      style={{ backgroundColor: state.profile?.id_submitted ? 'rgba(0,217,126,0.1)' : C.goldDim, borderRadius:14, padding:14, borderWidth:1, borderColor: state.profile?.id_submitted ? C.green : C.gold, flexDirection:'row', alignItems:'center', gap:12, marginBottom:12, marginTop:4 }}>
                      <Text style={{ fontSize:24 }}>{state.profile?.id_submitted ? '✅' : '🪪'}</Text>
                      <View style={{ flex:1 }}>
                        <Text style={{ color: state.profile?.id_submitted ? C.green : C.gold, fontWeight:'900', fontSize:14 }}>
                          {state.profile?.id_submitted ? 'ID Submitted — Under Review' : 'Verify Driver Identity'}
                        </Text>
                        <Text style={{ color:C.gray, fontSize:11, marginTop:2 }}>
                          {state.profile?.id_submitted
                            ? `ID: ${state.profile?.national_id || '—'} · ${state.profile?.id_verified_name || ''}`
                            : 'Scan National ID + Driver Permit to unlock full access'}
                        </Text>
                      </View>
                      <Text style={{ color:C.gold, fontSize:18 }}>›</Text>
                    </TouchableOpacity>
                    {/* Driver payment info summary */}
                    <View style={styles.driverPayInfo}>
                      <Text style={styles.driverPayLabel}>{t.paymentSetup}</Text>
                      {state.profile?.momo_name?(
                        <View style={ { marginTop: 6 }}>
                          <Text style={ { color: C.white, fontWeight: '700', fontSize: 13 }}>{state.profile.momo_name}</Text>
                          <Text style={ { color: C.mtn, fontSize: 12, marginTop: 2 }}>
                            MTN: {state.profile.momo_type === 'merchant' ? state.profile.momo_merchant_code : state.profile.momo_number}
                          </Text>
                          {state.profile.airtel_number && (
                            <Text style={ { color: C.airtel, fontSize: 12, marginTop: 2 }}>
                              Airtel: {state.profile.airtel_number}
                            </Text>
                          )}
                        </View>
                      ): (
                        <Text style={ { color: C.orange, fontSize: 12, marginTop: 6 }}>⚠️ {t.noPaymentWarning}</Text>
                      )}
                      <TouchableOpacity style={[styles.outlineBtn, { marginTop: 10 }]} onPress={() => {
                        setProfileModal(false);
                        setTimeout(() => setPaySetupModal(true), 320);
                      }}>
                        <Text style={styles.outlineBtnTxt}>✏️ {t.paymentSetup}</Text>
                      </TouchableOpacity>
                    </View>
                    {/* Earnings Dashboard — driver only */}
                    <EarningsDashboard
                      driverId={state.session?.user?.id}
                      t={t}
                      />
                  </>
                )}
                {/* Emergency Contact — shown for both passenger and driver */}
                <View style={styles.sosContactBox}>
                  <Text style={styles.sosContactLabel}>🚨 {t.emergencyContact}</Text>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>{t.emergencyName}</Text>
                    <TextInput style={styles.input}
                      placeholder="e.g. Marie Claire"
                      placeholderTextColor={C.grayDark}
                      value={state.profile?.emergency_name}
                      onChangeText={txt=>dispatch( { type: 'SET_PROFILE', p: { ...state.profile, emergency_name: txt } })} />
                  </View>
                  <View style={styles.inputWrap}>
                    <Text style={styles.inputLabel}>{t.emergencyPhone}</Text>
                    <TextInput style={styles.input}
                      placeholder="+250 7XX XXX XXX"
                      placeholderTextColor={C.grayDark}
                      keyboardType="phone-pad"
                      value={state.profile?.emergency_phone}
                      onChangeText={txt=>dispatch( { type: 'SET_PROFILE', p: { ...state.profile, emergency_phone: txt } })} />
                  </View>
                </View>

                {/* Referral Code Section */}
                <View style={styles.referralBox}>
                  <Text style={styles.referralLabel}>🎁 {t.referralCode}</Text>
                  <View style={styles.referralCodeRow}>
                    <Text style={styles.referralCodeTxt}>{state.profile?.referral_code || '—'}</Text>
                    <TouchableOpacity
                      style={styles.referralShareBtn}
                      onPress={()=> {
                        const code = state.profile?.referral_code || '';
                        if (!code) {
                          showBanner('⚠️ MotoLink', 'Referral code not available yet.', 'warning');
                          return;
                        }
                        const msg = `🛵 *Join MotoLink!*\n\nUse my referral code: *${code}*\n\nDownload MotoLink — The Future of Ride-Hailing in Rwanda.\n\n_Powered by MotoLink_`;
                        const wa = `https://wa.me/?text=${encodeURIComponent(msg)}`;
                        Linking.openURL(wa).catch(()=> showBanner('❌', 'WhatsApp not installed', 'error'));
                      }}>
                      <Text style={styles.referralShareTxt}>📲 {t.referralShare}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={ { color: C.gray,
                    fontSize: 11,
                    marginTop: 6,
                    lineHeight: 16 }}>{t.referralInfo}</Text>
                  {(state.profile?.referral_earnings || 0) > 0 && (
                    <View style={styles.referralEarnedRow}>
                      <Text style={ { color: C.gray, fontSize: 12 }}>{t.referralEarned}</Text>
                      <Text style={ { color: C.green, fontWeight: '900', fontSize: 14 }}>{fmtFRW(state.profile?.referral_earnings || 0)}</Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity style={styles.mainBtn} onPress={updateProfile} disabled={rideLoading}>
                  {rideLoading?<ActivityIndicator color={C.black} />: <Text style={styles.mainBtnTxt}>{t.save.toUpperCase()}</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={()=> { clearSession(); setProfileModal(false); dispatch( { type: 'LOGOUT' }); }}
                  style={[styles.outlineBtn,
                    { marginTop: 12 }]}>
                  <Text style={styles.outlineBtnTxt}>🚪 {t.signOut}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setProfileModal(false); setTimeout(() => handleDeleteAccount(), 350); }} style={[styles.outlineBtn,
                  { borderColor: C.red,
                    marginTop: 10 }]}>
                  <Text style={[styles.outlineBtnTxt,
                    { color: C.red }]}>🗑️ {t.deleteAcc}</Text>
                </TouchableOpacity>
                {/* Legal links */}
                <View style={{ flexDirection:'row', justifyContent:'center', gap:20, marginTop:20 }}>
                  <TouchableOpacity onPress={() => { setProfileModal(false); setTimeout(() => setShowTOS(true), 300); }}>
                    <Text style={{ color:C.grayDark, fontSize:11, textDecorationLine:'underline' }}>{t.termsOfService}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setProfileModal(false); setTimeout(() => setShowPrivacy(true), 300); }}>
                    <Text style={{ color:C.grayDark, fontSize:11, textDecorationLine:'underline' }}>{t.privacyPolicy}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ color:C.grayDark, fontSize:10, textAlign:'center', marginTop:8 }}>MotoLink v{APP_VERSION} · Kigali, Rwanda</Text>
                <TouchableOpacity onPress={()=>setProfileModal(false)} style={ { marginTop: 14 }}>
                  <Text style={ { color: C.gray,
                    textAlign: 'center',
                    fontSize: 13 }}>{t.close}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Offline Banner */}
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerTxt}>📡 {t.offlineMode} — {t.offlineMsg}</Text>
            {offlineQueue.length > 0 && (
              <Text style={styles.offlineBannerSub}>{offlineQueue.length} request(s) queued</Text>
            )}
          </View>
        )}

        {/* Leaderboard Modal */}
        <Modal visible={showLeaderboard} transparent animationType="slide">
          <View style={styles.modalBg}>
            <View style={styles.glassModal}>
              <View style={ { flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 16 }}>
                <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
                <Text style={[styles.historyTitle,
                  { flex: 1 }]}>{t.leaderboard}</Text>
                <TouchableOpacity onPress={()=>setShowLeaderboard(false)} style={styles.closeBtn}>
                  <Text style={ { color: C.gray,
                    fontSize: 18 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={ { color: C.gray,
                fontSize: 12,
                marginBottom: 14 }}>{t.topDrivers}</Text>
              {leaderboard.map((drv, i)=>(
                <View key={drv.id} style={[styles.leaderRow, drv.id === state.session?.user?.id && { backgroundColor: C.goldDim, borderColor: C.gold }]}>
                  <Text style={styles.leaderRank}>{i === 0?'🥇': i === 1?'🥈': i === 2?'🥉': `#${i+1}`}</Text>
                  <View style={ { flex: 1, marginLeft: 10 }}>
                    <Text style={ { color: C.white, fontWeight: '700', fontSize: 13 }}>{drv.name}{drv.id === state.session?.user?.id?' (You)': ''}</Text>
                    <Text style={ { color: C.gray, fontSize: 11, marginTop: 1 }}>★ {(drv.rating || 5).toFixed(1)}</Text>
                  </View>
                  <View style={ { alignItems: 'flex-end' }}>
                    <Text style={ { color: C.gold, fontWeight: '900', fontSize: 14 }}>{drv.weekly_trips} trips</Text>
                    <Text style={ { color: C.green, fontSize: 11 }}>{fmtFRW(drv.weekly_earnings)}</Text>
                  </View>
                </View>
              ))}
              {leaderboard.length === 0 && <Text style={styles.emptyText}>No data yet this week.</Text>}
            </View>
          </View>
        </Modal>

        {/* SOS Confirmation Modal */}
        <Modal visible={sosModal} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={[styles.glassModal,
              { alignItems: 'center' }]}>
              {/* ── UPGRADE: ❌ close button ── */}
              <TouchableOpacity
                onPress={() => setSosModal(false)}
                style={ { position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  justifyContent: 'center',
                  alignItems: 'center' }}
                >
                <Text style={ { color: C.gray,
                  fontSize: 16,
                  fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
              <Text style={ { fontSize: 48,
                marginBottom: 8 }}>🚨</Text>
              <Text style={[styles.splashTitle,
                { fontSize: 22,
                  color: C.red,
                  letterSpacing: 2 }]}>{t.sosTitle}</Text>
              <Text style={ { color: C.gray,
                fontSize: 13,
                textAlign: 'center',
                marginTop: 12,
                marginBottom: 24,
                lineHeight: 20 }}>
                {t.sosConfirm}
              </Text>
              {state.profile?.emergency_name && (
                <TouchableOpacity
                  style={[styles.sosContactBox, { width: '100%', marginBottom: 16, borderColor: C.red, borderWidth: 1.5 }]}
                  activeOpacity={0.7}
                  onPress={() => {
                    const phone = state.profile.emergency_phone?.replace(/[^0-9+]/g, '');
                    if (phone) Linking.openURL(`tel:${phone}`).catch(() => {});
                  }}>
                  <Text style={styles.sosContactLabel}>📞 {t.emergencyContact} — tap to call</Text>
                  <View style={ { flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 4 }}>
                    <View>
                      <Text style={ { color: C.white,
                        fontWeight: '700',
                        fontSize: 14 }}>{state.profile.emergency_name}</Text>
                      <Text style={ { color: C.red,
                        fontSize: 12,
                        fontWeight: '600' }}>{state.profile.emergency_phone}</Text>
                    </View>
                    <View style={ { backgroundColor: C.red,
                      borderRadius: 20,
                      paddingHorizontal: 12,
                      paddingVertical: 6 }}>
                      <Text style={ { color: C.white,
                        fontSize: 12,
                        fontWeight: '800' }}>📞 CALL</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.mainBtn, { width: '100%', backgroundColor: C.red }]} onPress={triggerSOS}>
                <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.sosSend}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSosModal(false)} style={ { marginTop: 16 }}>
                <Text style={ { color: C.gray, fontSize: 14, textAlign: 'center' }}>{t.sosCancel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Floating SOS Button — always on top, draggable */}
        {state.step === 'app' && <SOSButton onPress={()=>setSosModal(true)} />}

        {/* Trip History Modal */}
        <TripHistoryModal
          visible={historyModal}
          onClose={()=>setHistoryModal(false)}
          userId={state.session?.user?.id}
          role={state.role}
          t={t}
          onCompleteTrip={(trip)=> {
            dispatch( { type: 'SET_ACTIVE_TRIP',
              p: trip });
            requestCompletion();
          }}
          onCancelTrip={(id,
            otherId)=>cancelTrip(id,
            otherId)}
          onConfirmPayment={async(trip)=> {
            dispatch( { type: 'SET_ACTIVE_TRIP',
              p: trip });
            if (state.role === 'passenger') await passengerConfirmComplete();
            else await driverConfirmPayment();
          }}
          />

        {/* AI Chat Modal */}
        <AIChatModal
          visible={showAIChat}
          onClose={() => setShowAIChat(false)}
          profile={state.profile}
          lang={state.lang}
          role={state.role}
          onAction={(action) => {
            setShowAIChat(false);
            setTimeout(() => {
              if (action.type === 'SEARCH_DESTINATION' && action.destination) {
                setSearchQuery(action.destination);
                setTimeout(() => handleSearchInput(action.destination), 300);
              } else if (action.type === 'BOOK_RIDE_NOW') {
                // Set destination if provided, then book immediately
                if (action.destination) {
                  setSearchQuery(action.destination);
                  setTripMode('now');
                  setTimeout(() => handleSearchInput(action.destination), 300);
                }
              } else if (action.type === 'SCHEDULE_RIDE') {
                // Open panel to scheduled tab
                if (!state.menuOpen) dispatch({ type: 'TOGGLE_MENU' });
                setPaxTab('scheduled');
                if (action.destination) {
                  setSearchQuery(action.destination);
                  setTimeout(() => handleSearchInput(action.destination), 400);
                }
              } else if (action.type === 'SET_DELIVERY_MODE') {
                setServiceMode('delivery');
                if (action.destination) {
                  setSearchQuery(action.destination);
                  setTimeout(() => handleSearchInput(action.destination), 300);
                }
              } else if (action.type === 'SET_PAYMENT_MOMO') {
                setPaymentMethod('momo');
                showBanner('📲 MotoLink', 'Payment set to MTN MoMo', 'success');
              } else if (action.type === 'SET_PAYMENT_AIRTEL') {
                setPaymentMethod('airtel');
                showBanner('📲 MotoLink', 'Payment set to Airtel Money', 'success');
              } else if (action.type === 'SET_PAYMENT_CASH') {
                setPaymentMethod('cash');
                showBanner('💵 MotoLink', 'Payment set to Cash', 'success');
              } else if (action.type === 'OPEN_SCHEDULE') {
                if (!state.menuOpen) dispatch({ type: 'TOGGLE_MENU' });
                setPaxTab('scheduled');
              } else if (action.type === 'OPEN_HISTORY' || action.type === 'OPEN_EARNINGS') {
                setHistoryModal(true);
              } else if (action.type === 'OPEN_PAYMENT' || action.type === 'OPEN_PAYMENT_SETUP') {
                setPaySetupModal(true);
              } else if (action.type === 'OPEN_LEADERBOARD') {
                setShowLeaderboard(true);
              }
            }, 350);
          }}
          />

        {/* Header */}
        <SafeAreaView edges={['top']} style={styles.header}>
          {/* Search bar — full width, always visible for passenger */}
          {state.role === 'passenger' && !state.menuOpen && !AT && (
            <View style={styles.searchRow}
              onLayout={e => {
                const { y, height } = e.nativeEvent.layout;
                setSearchBarBottom(y + height + 6);
              }}>
              <View style={styles.searchContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder={t.searchWhere}
                  placeholderTextColor="#888"
                  value={searchQuery}
                  onChangeText={handleSearchInput}
                  onSubmitEditing={triggerSearch}
                  returnKeyType="search"
                  autoCorrect={false}
                  autoCapitalize="none"
                  blurOnSubmit={false}
                  />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => { setSearchQuery(''); setSuggestions([]); setDestCoords(null); setTargetLocation(null); setDestName(''); }}
                    style={ { paddingHorizontal: 8, paddingVertical: 4 }}
                    hitSlop={ { top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={ { color: '#888', fontSize: 17, fontWeight: '600' }}>✕</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={triggerSearch} style={styles.searchIconBtn} activeOpacity={0.75}>
                  {searchLoading
                  ? <ActivityIndicator size="small" color={C.black} />: <Text style={ { fontSize: 17 }}>🔍</Text>}
                </TouchableOpacity>
              </View>
              {/* Saved Places quick shortcuts */}
              {state.favorites?.filter(f=>['home','work'].includes(f.key) && f.address).length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop:6 }} contentContainerStyle={{ gap:8, paddingHorizontal:2 }}>
                  {state.favorites.filter(f=>['home','work','fav1','fav2'].includes(f.key) && f.address).map(fav => (
                    <TouchableOpacity key={fav.key}
                      onPress={() => { setSearchQuery(fav.address); handleSearchInput(fav.address); }}
                      style={{ backgroundColor:C.charcoal, borderRadius:20, paddingHorizontal:14, paddingVertical:7, borderWidth:1, borderColor:C.border, flexDirection:'row', alignItems:'center', gap:6 }}>
                      <Text style={{ fontSize:13 }}>{fav.key==='home'?'🏠':fav.key==='work'?'💼':'⭐'}</Text>
                      <Text style={{ color:C.offWhite, fontSize:12, fontWeight:'600' }}>{fav.key==='home'?'Home':fav.key==='work'?'Work':fav.label}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => setShowFavorites(true)}
                    style={{ backgroundColor:C.goldDim, borderRadius:20, paddingHorizontal:14, paddingVertical:7, borderWidth:1, borderColor:C.gold }}>
                    <Text style={{ color:C.gold, fontSize:12, fontWeight:'700' }}>+ Add</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
              {!state.favorites?.filter(f=>['home','work'].includes(f.key) && f.address).length && (
                <TouchableOpacity onPress={() => setShowFavorites(true)} style={{ marginTop:6, alignSelf:'flex-start' }}>
                  <Text style={{ color:C.grayDark, fontSize:11 }}>⭐ Save Home & Work →</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {/* Icon row — different layout for passenger vs driver */}
          {state.role === 'driver' ? (
            // Driver: title row + icon row stacked
            <View style={{ width: '100%' }}>
              {/* Row 1: ML logo + title */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <View style={styles.splashLogoRingSmall}>
                  <Text style={styles.splashLogoTxtSmall}>ML</Text>
                </View>
                <Text style={[styles.driverDashTxt, { marginLeft: 10, flex: 1 }]} numberOfLines={1}>
                  {t.driverDash}
                </Text>
              </View>
              {/* Row 2: icon buttons — evenly spaced, never overflow */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity style={styles.historyBtn} onPress={() => setHistoryModal(true)}>
                  <Text style={{ fontSize: 17 }}>🕐</Text>
                </TouchableOpacity>
                {/* AI Chat button */}
                <View style={{ position: 'relative' }}>
                  <TouchableOpacity
                    style={[styles.historyBtn, { backgroundColor: C.goldDim, borderColor: C.gold }]}
                    onPress={() => { setAiTooltipVisible(false); if (aiTooltipHideTimer.current) clearTimeout(aiTooltipHideTimer.current); setShowAIChat(true); }}>
                    <Text style={{ fontSize: 16 }}>🏍️</Text>
                  </TouchableOpacity>
                  {aiTooltipVisible && (() => {
                    const msgs = AI_TOOLTIP_MESSAGES[state.lang] || AI_TOOLTIP_MESSAGES.en;
                    const msg = msgs[aiTooltipMsgIdx.current % msgs.length];
                    return (
                      <Animated.View style={{
                        position: 'absolute', top: 52, left: 0,
                        opacity: aiTooltipAnim,
                        transform: [{ scale: aiTooltipScaleX },
                          { translateY: aiTooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
                        zIndex: 9999,
                      }} pointerEvents="box-none">
                        <TouchableOpacity activeOpacity={0.9}
                          onPress={() => { setAiTooltipVisible(false); if (aiTooltipHideTimer.current) clearTimeout(aiTooltipHideTimer.current); setShowAIChat(true); }}
                          style={{
                            backgroundColor: '#1A6BB5', borderRadius: 16, borderTopLeftRadius: 4,
                            paddingHorizontal: 13, paddingVertical: 9, maxWidth: 240, minWidth: 160,
                            shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.35, shadowRadius: 12, elevation: 10,
                            borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
                          }}>
                          <Text style={{ color: '#FFF', fontSize: 12.5, fontWeight: '600', lineHeight: 18 }}>{msg}</Text>
                          <View style={{
                            position: 'absolute', top: -7, left: 14,
                            borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 8,
                            borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#1A6BB5',
                          }} />
                        </TouchableOpacity>
                      </Animated.View>
                    );
                  })()}
                </View>
                {/* Language picker */}
                <TouchableOpacity
                  onPress={() => { const ls = ['en','rw','fr']; dispatch({ type: 'SET_LANG', p: ls[(ls.indexOf(state.lang)+1)%ls.length] }); }}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.charcoal, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: C.gold, fontWeight: '900', fontSize: 10, letterSpacing: 0.5 }}>
                    {(state.lang || 'EN').toUpperCase()}
                  </Text>
                </TouchableOpacity>
                {/* Avatar */}
                <TouchableOpacity style={styles.avatarWrap} onPress={() => setProfileModal(true)}>
                  {(state.profile?.avatar_url || state.profile?.avatar)
                    ? <Image source={{ uri: state.profile.avatar_url || state.profile.avatar }} style={styles.avatarImg} />
                    : <Text style={styles.avatarTxt}>{state.profile?.name?.substring(0,2).toUpperCase() || 'ME'}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Passenger: single icon row
            <View style={styles.headerRow}>
              <MorphingMenu isOpen={state.menuOpen} onPress={() => dispatch({ type: 'TOGGLE_MENU' })} />
              <TouchableOpacity
                style={[styles.historyBtn, { marginLeft: 6 }]}
                onPress={() => setHistoryModal(true)}>
                <Text style={{ fontSize: 18 }}>🕐</Text>
              </TouchableOpacity>
              {/* AI Chat Button + Animated Tooltip */}
              <View style={{ position: 'relative' }}>
                <TouchableOpacity
                  style={[styles.historyBtn, { backgroundColor: C.goldDim, borderWidth: 1.5, borderColor: C.gold }]}
                  onPress={() => { setAiTooltipVisible(false); if (aiTooltipHideTimer.current) clearTimeout(aiTooltipHideTimer.current); setShowAIChat(true); }}>
                  <Text style={{ fontSize: 16 }}>🏍️</Text>
                </TouchableOpacity>
                {/* Tooltip bubble — appears BELOW the button, anchored LEFT so it never clips off screen */}
                {aiTooltipVisible && (() => {
                  const msgs = AI_TOOLTIP_MESSAGES[state.lang] || AI_TOOLTIP_MESSAGES.en;
                  const msg = msgs[aiTooltipMsgIdx.current % msgs.length];
                  return (
                    <Animated.View style={{
                      position: 'absolute', top: 52, left: 0,
                      opacity: aiTooltipAnim,
                      transform: [{ scale: aiTooltipScaleX },
                        { translateY: aiTooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
                      zIndex: 9999,
                    }} pointerEvents="box-none">
                      <TouchableOpacity activeOpacity={0.9}
                        onPress={() => { setAiTooltipVisible(false); if (aiTooltipHideTimer.current) clearTimeout(aiTooltipHideTimer.current); setShowAIChat(true); }}
                        style={{
                          backgroundColor: '#1A6BB5', borderRadius: 16, borderTopLeftRadius: 4,
                          paddingHorizontal: 13, paddingVertical: 9, maxWidth: 240, minWidth: 160,
                          shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
                          shadowOpacity: 0.35, shadowRadius: 12, elevation: 10,
                          borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
                        }}>
                        <Text style={{ color: '#FFF', fontSize: 12.5, fontWeight: '600', lineHeight: 18 }}>{msg}</Text>
                        <View style={{
                          position: 'absolute', top: -7, left: 14,
                          borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 8,
                          borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#1A6BB5',
                        }} />
                      </TouchableOpacity>
                    </Animated.View>
                  );
                })()}
              </View>
              {/* Language picker */}
              <TouchableOpacity
                onPress={() => { const ls = ['en','rw','fr']; dispatch({ type: 'SET_LANG', p: ls[(ls.indexOf(state.lang)+1)%ls.length] }); }}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.charcoal, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: C.gold, fontWeight: '900', fontSize: 10, letterSpacing: 0.5 }}>
                  {(state.lang || 'EN').toUpperCase()}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.avatarWrap} onPress={() => setProfileModal(true)}>
                {(state.profile?.avatar_url || state.profile?.avatar)
                  ? <Image source={{ uri: state.profile.avatar_url || state.profile.avatar }} style={styles.avatarImg} />
                  : <Text style={styles.avatarTxt}>{state.profile?.name?.substring(0,2).toUpperCase() || 'ME'}</Text>}
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>

        {/* ── Suggestion overlay — positioned dynamically below search bar ─────── */}
        {state.role === 'passenger' && !state.menuOpen && !AT && suggestions.length > 0 && (
          <View style={[styles.suggestionOverlay, { top: searchBarBottom }]} pointerEvents="box-none">
            <ScrollView
              style={[styles.suggestionBox, webStyle({ backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' })]}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled={false}
              >
              {suggestions.map((item, i) => {
                const label = buildLabel(item);
                // Google Places: use secondary_text for suburb. Others: build from address
                const sub = item._isManual
                ? '📌 Tap to confirm this as your destination': item.structured?.secondary_text
                ? item.structured.secondary_text: item._gemini
                ? ('🤖 AI: ' + (item.description || '')): item.display_name?.split(',').slice(1, 3).join(',').trim() || '';
                const icon = item._isManual ? '🗺️': item._gemini ? '🤖': item._source === 'google' ? '📍': '📌';
                const iconBg = item._isManual
                ? 'rgba(212,175,55,0.15)': item._gemini
                ? 'rgba(100,200,255,0.12)': 'rgba(46,204,113,0.12)';
                return (
                  <TouchableOpacity
                    key={item.place_id || i}
                    style={[
                      styles.suggestionItem,
                      i === suggestions.length - 1 && { borderBottomWidth: 0 },
                      item._isManual && { backgroundColor: 'rgba(212,175,55,0.06)' },
                    ]}
                    activeOpacity={0.6}
                    onPress={() => selectDestination(item)}
                    >
                    <View style={ { flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={ {
                        width: 32, height: 32, borderRadius: 16,
                        backgroundColor: iconBg,
                        justifyContent: 'center', alignItems: 'center', flexShrink: 0,
                      }}>
                        <Text style={ { fontSize: 14 }}>{icon}</Text>
                      </View>
                      <View style={ { flex: 1 }}>
                        <Text style={[styles.suggestionTitle, item._isManual && { color: C.gold }]} numberOfLines={1}>
                          {label}
                        </Text>
                        {sub ? <Text style={styles.suggestionSub} numberOfLines={1}>{sub}</Text>: null}
                      </View>
                      <Text style={ { color: C.border, fontSize: 18 }}>›</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Passenger trip panel */}
        <Animated.View style={[styles.statusPanel,
          { transform: [{ translateY: menuAnim }]},
          webStyle({ backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' })]}>
          <View style={styles.panelHeader}>
            <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
            <Text style={styles.panelTitle}>{t.myRequests}</Text>
          </View>
          {/* Tab bar — state is top-level, no hooks inside render */}
          <View style={ { flexDirection: 'row',
            gap: 8,
            paddingHorizontal: 12,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(255,255,255,0.06)' }}>
            {[['active', '🛵 ' + t.rideMode], ['scheduled', '📅 ' + (t.scheduledTrip||'Scheduled').replace('📅 ','')]].map(([key, label]) => (
                <TouchableOpacity key={key} onPress={() => setPaxTab(key)}
                  style={ { flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: 'center',
                    backgroundColor: paxTab === key ? C.goldDim: 'transparent',
                    borderWidth: paxTab === key ? 1: 0, borderColor: C.gold }}>
                  <Text style={ { color: paxTab === key ? C.gold: C.gray, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                </TouchableOpacity>
              ))}
          </View>
          {paxTab === 'scheduled' ? (
            <ScheduledTripsPanel
              role="passenger" session={state.session} profile={state.profile}
              t={t} C={C} styles={styles} fmtFRW={fmtFRW}
              notify={notify} showBanner={showBanner}
              getPushToken={getPushToken} sendExpoPush={sendExpoPush}
              />
          ): (
            <ScrollView style={ { maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {state.myTrips.length === 0 && <Text style={styles.emptyText}>{t.noRequests}</Text>}
              {state.myTrips.map(trip => (
                <View key={trip.id} style={styles.tripCard}>
                  <View style={ { flex: 1 }}>
                    <View style={styles.routeBlock}><View style={styles.routeDot} /><Text style={ { color: C.gray, fontSize: 12, flex: 1 }} numberOfLines={1}>{trip.pickup_address}</Text></View>
                    <View style={styles.routeLine_} />
                    <View style={styles.routeBlock}><View style={[styles.routeDot, { backgroundColor: C.green }]} /><Text style={ { color: C.white, fontSize: 12, fontWeight: '700', flex: 1 }} numberOfLines={1}>{trip.destination_address}</Text></View>
                    <View style={ { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <Text style={ { color: C.gold, fontWeight: '900', fontSize: 13 }}>{fmtFRW(trip.price)}</Text>
                    </View>
                    <View style={styles.timestampRow}>
                      <Text style={styles.timestampTxt}>🕐 {t.sentAt}: {fmtTime(trip.created_at)}</Text>
                      {trip.accepted_at && <Text style={[styles.timestampTxt, { color: C.green }]}>✅ {t.acceptedAt}: {fmtTime(trip.accepted_at)}</Text>}
                      {trip.cancelled_at && <Text style={[styles.timestampTxt, { color: C.red }]}>❌ {t.cancelledAt}: {fmtTime(trip.cancelled_at)}</Text>}
                    </View>
                    {/* Status pill */}
                    {trip.status === 'completion_requested' && (
                      <View style={[styles.statusPill, { backgroundColor: C.blueDim }]}>
                        <Text style={[styles.statusPillTxt, { color: C.blue }]}>🏁 {t.confirmComplete}</Text>
                      </View>
                    )}
                    {trip.status === 'awaiting_driver_confirm' && (
                      <View style={[styles.statusPill, { backgroundColor: C.greenDim }]}>
                        <Text style={[styles.statusPillTxt, { color: C.green }]}>💰 {t.awaitingDriverConfirm}</Text>
                      </View>
                    )}
                    {trip.status === 'accepted' && (
                      <View style={styles.driverInfoBox}>
                        <View style={ { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={styles.driverInfoName}>🏍️ {trip.driver_name || 'Driver'}</Text>
                          <DriverRatingBadge driverId={trip.driver_id} />
                        </View>
                        <Text style={styles.driverInfoDist}>📡 {getDistance(state.myLocation?.latitude, state.myLocation?.longitude, targetLocation?.latitude, targetLocation?.longitude)} {t.km}</Text>
                        {/* Call driver button — always visible when accepted */}
                        <TouchableOpacity
                          onPress={() => {
                            if (trip.driver_phone) Linking.openURL(`tel:${trip.driver_phone}`).catch(() => {});
                            else showBanner('📞 MotoLink', 'Driver phone not available.', 'warning');
                          }}
                          style={[styles.callPill, { backgroundColor: C.green + '22', borderColor: C.green, marginTop: 8, alignSelf: 'flex-start' }]}>
                          <Text style={[styles.callPillTxt, { color: C.green }]}>📞 {t.callDriver}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  {/* Only allow cancel on trips that haven't been accepted yet */}
                  {['searching', 'scheduled'].includes(trip.status) && (
                    <TouchableOpacity onPress={()=>cancelTrip(trip.id, trip.driver_id || null)} style={styles.cancelBtn}>
                      <Text style={styles.cancelBtnTxt}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </Animated.View>

        {/* ════════════════════════════════════════════════════════════
            ACTIVE TRIP FULL-SCREEN OVERLAY  —  Spotify-style collapsible
            Pull handle DOWN to peek at map; pull UP to expand again.
            ════════════════════════════════════════════════════════════ */}
        {AT && ['accepted','completion_requested','awaiting_driver_confirm','picked_up','searching'].includes(AT.status) && (
          <Animated.View style={{
            position:'absolute', bottom:0, left:0, right:0,
            backgroundColor: C.card,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderTopWidth: 2,
            borderColor: AT.status === 'accepted' ? C.green :
              AT.status === 'awaiting_driver_confirm' ? C.gold :
              AT.status === 'completion_requested' ? C.blue : C.border,
            zIndex: 200, elevation: 100,
            maxHeight: height * 0.72,
            shadowColor: '#000', shadowOffset:{width:0,height:-4}, shadowOpacity:0.4, shadowRadius:12,
            transform: [{ translateY: tripSheetAnim }],
          }}>
            {/* ── Draggable Handle Bar ── */}
            <View
              style={{ paddingVertical: 10, alignItems: 'center', cursor: 'grab' }}
              onTouchStart={(e) => {
                tripDragStartY.current = e.nativeEvent.pageY;
              }}
              onTouchMove={(e) => {
                if (tripDragStartY.current === null) return;
                const dy = e.nativeEvent.pageY - tripDragStartY.current;
                if (!tripSheetIsMin.current && dy > 0) {
                  // Dragging down while expanded — clamp
                  tripSheetAnim.setValue(Math.min(dy, TRIP_COLLAPSED));
                } else if (tripSheetIsMin.current && dy < 0) {
                  // Dragging up while minimised — clamp
                  tripSheetAnim.setValue(Math.max(TRIP_COLLAPSED + dy, 0));
                }
              }}
              onTouchEnd={(e) => {
                if (tripDragStartY.current === null) return;
                const dy = e.nativeEvent.pageY - tripDragStartY.current;
                tripDragStartY.current = null;
                const threshold = 60;
                if (!tripSheetIsMin.current) {
                  if (dy > threshold) {
                    // Minimise
                    Animated.spring(tripSheetAnim, {
                      toValue: TRIP_COLLAPSED, useNativeDriver: Platform.OS !== 'web',
                      tension: 70, friction: 12,
                    }).start();
                    tripSheetIsMin.current = true;
                  } else {
                    Animated.spring(tripSheetAnim, {
                      toValue: 0, useNativeDriver: Platform.OS !== 'web',
                      tension: 70, friction: 12,
                    }).start();
                  }
                } else {
                  if (dy < -threshold) {
                    // Expand
                    Animated.spring(tripSheetAnim, {
                      toValue: 0, useNativeDriver: Platform.OS !== 'web',
                      tension: 70, friction: 12,
                    }).start();
                    tripSheetIsMin.current = false;
                  } else {
                    Animated.spring(tripSheetAnim, {
                      toValue: TRIP_COLLAPSED, useNativeDriver: Platform.OS !== 'web',
                      tension: 70, friction: 12,
                    }).start();
                  }
                }
              }}
            >
              {/* Visual pill */}
              <View style={{
                height: 4, width: 44, backgroundColor: C.gold + '88',
                borderRadius: 2,
              }}/>
              {/* Mini hint text that fades in when sheet is peeked */}
              <Text style={{ color: C.grayDark, fontSize: 10, marginTop: 3, letterSpacing: 0.5 }}>
                ↕ {tripSheetIsMin.current ? 'Pull up to expand' : 'Pull down to see map'}
              </Text>
            </View>

            {/* Status banner */}
            <View style={{
              flexDirection:'row', alignItems:'center',
              backgroundColor: AT.status==='accepted' ? 'rgba(46,204,113,0.15)' :
                AT.status==='awaiting_driver_confirm' ? 'rgba(212,175,55,0.15)' :
                AT.status==='completion_requested' ? 'rgba(52,152,219,0.15)' : 'rgba(255,255,255,0.05)',
              paddingHorizontal:16, paddingVertical:10, gap:10,
              borderBottomWidth:1, borderBottomColor:'rgba(255,255,255,0.06)',
            }}>
              <Text style={{fontSize:26}}>
                {AT.status==='accepted' ? (state.role==='driver'?'🚦':'🏍️') :
                 AT.status==='awaiting_driver_confirm' ? '💰' :
                 AT.status==='completion_requested' ? '🏁' : '🔍'}
              </Text>
              <View style={{flex:1}}>
                <Text style={{color: AT.status==='accepted' ? C.green :
                  AT.status==='awaiting_driver_confirm' ? C.gold :
                  AT.status==='completion_requested' ? C.blue : C.gray,
                  fontWeight:'900', fontSize:14, letterSpacing:0.6}}>
                  {state.role==='passenger'
                    ? (AT.status==='accepted' ? '🏍️ DRIVER ON THE WAY' :
                       AT.status==='completion_requested' ? '🏁 CONFIRM YOUR TRIP' :
                       AT.status==='awaiting_driver_confirm' ? '⏳ AWAITING DRIVER' :
                       AT.status==='searching' ? '🔍 FINDING DRIVER...' : AT.status.toUpperCase())
                    : (AT.status==='accepted' ? '🚦 ACTIVE MISSION' :
                       AT.status==='completion_requested' ? '⏳ AWAITING PASSENGER' :
                       AT.status==='awaiting_driver_confirm' ? '💰 CONFIRM PAYMENT' :
                       AT.status==='picked_up' ? '📦 PACKAGE PICKED UP' :
                       AT.status==='searching' ? '🔍 PASSENGER SEARCHING' : AT.status.toUpperCase())}
                </Text>
                <Text style={{color:C.offWhite, fontSize:12, marginTop:1}} numberOfLines={1}>
                  {state.role==='passenger'
                    ? `${AT.driver_name||'Driver'} · ${fmtFRW(AT.price)}`
                    : `${AT.passenger_name||'Passenger'} · ${fmtFRW(AT.price)}`}
                </Text>
              </View>
              {/* Quick call button in banner */}
              <TouchableOpacity
                onPress={() => {
                  const phone = state.role==='passenger' ? AT.driver_phone : AT.passenger_phone;
                  if (phone) Linking.openURL(`tel:${phone}`).catch(()=>{});
                  else showBanner('📞 MotoLink', 'Phone number not available.', 'warning');
                }}
                style={{backgroundColor:C.green, borderRadius:22, paddingHorizontal:14, paddingVertical:8}}>
                <Text style={{color:C.white, fontWeight:'900', fontSize:12}}>📞 CALL</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
              contentContainerStyle={{padding:16, paddingBottom:24}}>

              {/* Route */}
              <View style={{backgroundColor:'rgba(255,255,255,0.04)', borderRadius:12, padding:12, marginBottom:12}}>
                <View style={{flexDirection:'row', alignItems:'center', gap:8, marginBottom:6}}>
                  <View style={{width:10,height:10,borderRadius:5,backgroundColor:C.gold,borderWidth:2,borderColor:C.white}}/>
                  <Text style={{color:C.gray, fontSize:12, flex:1}} numberOfLines={1}>{AT.pickup_address}</Text>
                </View>
                <View style={{width:2,height:16,backgroundColor:C.border,marginLeft:4,marginBottom:6}}/>
                <View style={{flexDirection:'row', alignItems:'center', gap:8}}>
                  <View style={{width:10,height:10,borderRadius:5,backgroundColor:C.green,borderWidth:2,borderColor:C.white}}/>
                  <Text style={{color:C.white, fontWeight:'700', fontSize:12, flex:1}} numberOfLines={1}>{AT.destination_address}</Text>
                </View>
              </View>

              {/* Fare + payment */}
              <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
                <Text style={{color:C.gold, fontWeight:'900', fontSize:28}}>{fmtFRW(AT.price)}</Text>
                <View style={{
                  backgroundColor: AT.payment_method==='momo' ? C.goldDim : AT.payment_method==='airtel' ? 'rgba(255,68,68,0.15)' : C.glassLight,
                  borderRadius:8, paddingHorizontal:10, paddingVertical:4
                }}>
                  <Text style={{
                    color: AT.payment_method==='momo' ? C.gold : AT.payment_method==='airtel' ? C.airtel : C.gray,
                    fontWeight:'700', fontSize:11
                  }}>
                    {AT.payment_method==='momo' ? '📱 MTN MoMo' : AT.payment_method==='airtel' ? '📱 Airtel' : '💵 Cash'}
                  </Text>
                </View>
              </View>

              {/* Contact + Share row */}
              <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:16, gap:8 }}>
                <View style={{
                  flex:1, backgroundColor:'rgba(255,255,255,0.04)', borderRadius:12,
                  padding:12, borderWidth:1, borderColor:C.border,
                }}>
                  <View style={{flex:1}}>
                    <Text style={{color:C.gray, fontSize:11}}>
                      {state.role==='passenger' ? t.driver : t.pax}
                    </Text>
                    <Text style={{color:C.white, fontWeight:'700', fontSize:15}}>
                      {state.role==='passenger' ? (AT.driver_name||'Driver') : (AT.passenger_name||'Passenger')}
                    </Text>
                    {AT.driver_plate && state.role==='passenger' && (
                      <View style={{ backgroundColor:C.goldDim, borderRadius:8, paddingHorizontal:8, paddingVertical:3, alignSelf:'flex-start', marginTop:4, borderWidth:1, borderColor:C.gold }}>
                        <Text style={{ color:C.gold, fontWeight:'900', fontSize:11 }}>🏍️ {AT.driver_plate}</Text>
                      </View>
                    )}
                    {state.role==='passenger'
                      ? <DriverRatingBadge driverId={AT.driver_id}/>
                      : <PassengerRatingBadge passengerId={AT.passenger_id}/>}
                  </View>
                </View>
                <View style={{ gap:8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      const phone = state.role==='passenger' ? AT.driver_phone : AT.passenger_phone;
                      if (phone) Linking.openURL(`tel:${phone}`).catch(()=>{});
                      else showBanner('📞 MotoLink', 'Phone number not available.', 'warning');
                    }}
                    style={{backgroundColor:C.green+'22', borderRadius:14, borderWidth:1.5,
                      borderColor:C.green, paddingHorizontal:14, paddingVertical:8}}
                    activeOpacity={0.7}>
                    <Text style={{color:C.green, fontWeight:'800', fontSize:12}}>
                      📞 {state.role==='passenger' ? t.callDriver : t.callPassenger}
                    </Text>
                  </TouchableOpacity>
                  {/* Share trip button — passenger only */}
                  {state.role==='passenger' && (
                    <TouchableOpacity
                      onPress={() => setShowShareTrip(true)}
                      style={{backgroundColor:C.blueDim, borderRadius:14, borderWidth:1.5, borderColor:C.blue, paddingHorizontal:14, paddingVertical:8}}
                      activeOpacity={0.7}>
                      <Text style={{color:C.blue, fontWeight:'800', fontSize:12}}>📤 Share</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* ── ACTION BUTTONS ── */}

              {/* PASSENGER: Share live trip — shown when driver is on the way or ride is active */}
              {state.role==='passenger' && ['accepted','picked_up'].includes(AT.status) && (
                <TouchableOpacity
                  style={{backgroundColor:C.blueDim, borderColor:C.blue, borderWidth:1.5, borderRadius:14, paddingVertical:13, alignItems:'center', marginBottom:10, flexDirection:'row', justifyContent:'center', gap:8}}
                  onPress={() => handleShareLiveTrip(AT.id)} activeOpacity={0.8}>
                  <Text style={{color:C.blue, fontWeight:'900', fontSize:14}}>🔗 SHARE LIVE TRIP</Text>
                </TouchableOpacity>
              )}

              {/* PASSENGER: Cancel while searching/accepted */}
              {state.role==='passenger' && AT.status==='accepted' && (
                <TouchableOpacity
                  style={{backgroundColor:C.red, borderRadius:14, paddingVertical:14, alignItems:'center', marginBottom:10}}
                  onPress={()=>cancelTrip(AT.id, AT.driver_id)} activeOpacity={0.8}>
                  <Text style={{color:C.white, fontWeight:'900', fontSize:14}}>✕ {t.cancelTrip}</Text>
                </TouchableOpacity>
              )}

              {/* PASSENGER: Confirm trip complete */}
              {state.role==='passenger' && AT.status==='completion_requested' && (
                <TouchableOpacity
                  style={{backgroundColor:C.green, borderRadius:14, paddingVertical:14, alignItems:'center', marginBottom:10}}
                  onPress={passengerConfirmComplete} activeOpacity={0.8}>
                  <Text style={{color:C.white, fontWeight:'900', fontSize:14}}>✅ {t.confirmComplete}</Text>
                </TouchableOpacity>
              )}

              {/* PASSENGER: Awaiting driver payment confirm */}
              {state.role==='passenger' && AT.status==='awaiting_driver_confirm' && (
                <View style={{backgroundColor:C.greenDim, borderRadius:14, paddingVertical:14, alignItems:'center', marginBottom:10}}>
                  <Text style={{color:C.green, fontWeight:'800', fontSize:13}}>💰 {t.awaitingDriverConfirm}</Text>
                </View>
              )}

              {/* DRIVER: Cancel + Arrived buttons */}
              {state.role==='driver' && AT.status==='accepted' && AT.trip_type!=='delivery' && (
                <View style={{flexDirection:'row', gap:10, marginBottom:10}}>
                  <TouchableOpacity
                    style={{flex:1, backgroundColor:C.red, borderRadius:14, paddingVertical:14, alignItems:'center'}}
                    onPress={()=>cancelTrip(AT.id, AT.passenger_id)} activeOpacity={0.8}>
                    <Text style={{color:C.white, fontWeight:'900', fontSize:13}}>✕ {t.cancelTrip}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{flex:1, backgroundColor:C.blue, borderRadius:14, paddingVertical:14, alignItems:'center'}}
                    onPress={requestCompletion} activeOpacity={0.8}>
                    <Text style={{color:C.white, fontWeight:'900', fontSize:13}}>🏁 {t.arrivedBtn}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* DRIVER: Delivery — picked up */}
              {state.role==='driver' && AT.trip_type==='delivery' && AT.status==='accepted' && (
                <TouchableOpacity
                  style={{backgroundColor:C.orange, borderRadius:14, paddingVertical:14, alignItems:'center', marginBottom:10}}
                  onPress={()=>updateDeliveryStatus('picked_up')} activeOpacity={0.8}>
                  <Text style={{color:C.white, fontWeight:'900', fontSize:14}}>📦 {t.pickedUp}</Text>
                </TouchableOpacity>
              )}

              {/* DRIVER: Delivery — delivered */}
              {state.role==='driver' && AT.trip_type==='delivery' && AT.status==='picked_up' && (
                <TouchableOpacity
                  style={{backgroundColor:C.green, borderRadius:14, paddingVertical:14, alignItems:'center', marginBottom:10}}
                  onPress={()=>updateDeliveryStatus('delivered')} activeOpacity={0.8}>
                  <Text style={{color:C.white, fontWeight:'900', fontSize:14}}>✅ {t.delivered}</Text>
                </TouchableOpacity>
              )}

              {/* DRIVER: Awaiting passenger confirm */}
              {state.role==='driver' && AT.status==='completion_requested' && (
                <View style={{backgroundColor:C.blueDim, borderRadius:14, paddingVertical:14, alignItems:'center', marginBottom:10}}>
                  <Text style={{color:C.blue, fontWeight:'800', fontSize:13}}>⏳ {t.awaitingPayment}</Text>
                </View>
              )}

              {/* DRIVER: Confirm payment received — prominent pulsing button */}
              {state.role==='driver' && AT.status==='awaiting_driver_confirm' && (
                <View style={{ marginBottom: 10 }}>
                  <View style={{ backgroundColor: 'rgba(0,217,126,0.1)', borderRadius: 14, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: C.green }}>
                    <Text style={{ color: C.green, fontWeight: '800', fontSize: 12, textAlign: 'center' }}>
                      💰 Passenger has paid — tap below to confirm
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={{ backgroundColor: C.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
                      shadowColor: C.green, shadowOffset: {width:0,height:4}, shadowOpacity: 0.5, shadowRadius: 14, elevation: 10 }}
                    onPress={driverConfirmPayment} activeOpacity={0.8}>
                    <Text style={{ color: C.white, fontWeight: '900', fontSize: 16, letterSpacing: 0.8 }}>💰 {t.driverConfirm}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Timestamps */}
              <View style={{marginTop:4, gap:3}}>
                <Text style={{color:C.grayDark, fontSize:11}}>🕐 {t.requestedAt}: {fmtDateTime(AT.created_at)}</Text>
                {AT.accepted_at && <Text style={{color:C.green, fontSize:11}}>✅ {t.acceptedAt}: {fmtTime(AT.accepted_at)}</Text>}
              </View>
            </ScrollView>
          </Animated.View>
        )}
        <View style={[styles.bottomSheet, webStyle({ backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)' })]}>
          <View style={ { height: 4,
            width: 40,
            backgroundColor: C.border,
            borderRadius: 2,
            alignSelf: 'center',
            marginBottom: 10 }} />
          {state.role === 'passenger'?(
            AT?(
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* ── Prominent accepted trip banner — shown for all active statuses ── */}
                {['accepted', 'completion_requested', 'awaiting_driver_confirm'].includes(AT.status) && (
                  <View style={ {
                    backgroundColor: AT.status === 'accepted' ? 'rgba(46,204,113,0.12)' :
                      AT.status === 'awaiting_driver_confirm' ? 'rgba(212,175,55,0.12)' : 'rgba(52,152,219,0.12)',
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: AT.status === 'accepted' ? C.green :
                      AT.status === 'awaiting_driver_confirm' ? C.gold : C.blue,
                    padding: 10,
                    marginBottom: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}>
                    <Text style={ { fontSize: 22 }}>
                      {AT.status === 'accepted' ? '🏍️' : AT.status === 'awaiting_driver_confirm' ? '💰' : '🏁'}
                    </Text>
                    <View style={ { flex: 1 }}>
                      <Text style={ { color: AT.status === 'accepted' ? C.green : AT.status === 'awaiting_driver_confirm' ? C.gold : C.blue, fontWeight: '900', fontSize: 13, letterSpacing: 0.5 }}>
                        {AT.status === 'accepted' ? 'DRIVER ON THE WAY' : AT.status === 'awaiting_driver_confirm' ? 'AWAITING DRIVER' : 'CONFIRM TRIP'}
                      </Text>
                      <Text style={ { color: C.offWhite, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{AT.driver_name || 'Your driver'} · {fmtFRW(AT.price)}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        if (AT.driver_phone) Linking.openURL(`tel:${AT.driver_phone}`).catch(() => {});
                        else showBanner('📞 MotoLink', 'Driver phone not available.', 'warning');
                      }}
                      style={ { backgroundColor: C.green, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={ { color: C.white, fontWeight: '800', fontSize: 11 }}>📞 CALL</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <Text style={styles.jobTitle}>{t.activeJob}</Text>
                <View style={styles.timestampRow}>
                  <Text style={styles.timestampTxt}>🕐 {t.requestedAt}: {fmtDateTime(AT.created_at)}</Text>
                  {AT.accepted_at && <Text style={[styles.timestampTxt, { color: C.green }]}>✅ {t.acceptedAt}: {fmtTime(AT.accepted_at)}</Text>}
                </View>
                <View style={[styles.routeBlock, { marginTop: 10 }]}><View style={styles.routeDot} /><Text style={ { color: C.gray, fontSize: 12, flex: 1 }} numberOfLines={1}>{AT.pickup_address}</Text></View>
                <View style={styles.routeLine_} />
                <View style={styles.routeBlock}><View style={[styles.routeDot, { backgroundColor: C.green }]} /><Text style={ { color: C.white, fontSize: 12, fontWeight: '700', flex: 1 }} numberOfLines={1}>{AT.destination_address}</Text></View>
                <View style={[styles.fareRow, { marginTop: 10 }]}>
                  <Text style={styles.fareAmt}>{fmtFRW(AT.price)}</Text>
                </View>
                {/* Status badge */}
                <View style={[styles.statusPill, {
                  backgroundColor: AT.status === 'accepted' ? C.greenDim:
                  AT.status === 'completion_requested' ? C.blueDim: C.goldDim,
                  alignSelf: 'flex-start', marginTop: 6, marginBottom: 4
                }]}>
                  <Text style={[styles.statusPillTxt, {
                    color: AT.status === 'accepted' ? C.green:
                    AT.status === 'completion_requested' ? C.blue: C.gold
                  }]}>
                    {AT.status === 'accepted' ? '🏍️ Driver on the way':
                    AT.status === 'completion_requested' ? '🏁 Confirm payment':
                    AT.status === 'awaiting_driver_confirm' ? '💰 Awaiting driver': AT.status}
                  </Text>
                </View>
                {/* Driver info row with call button — always visible during active trip */}
                <View style={styles.driverContactRow}>
                  <View style={ { flex: 1 }}>
                    <Text style={ { color: C.gray, fontSize: 11 }}>{t.driver}</Text>
                    <Text style={ { color: C.white, fontWeight: '700', fontSize: 15 }}>{AT.driver_name || 'Driver'}</Text>
                    <DriverRatingBadge driverId={AT.driver_id} />
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      if (AT.driver_phone) {
                        Linking.openURL(`tel:${AT.driver_phone}`).catch(() => {});
                      } else {
                        showBanner('📞 MotoLink', 'Driver phone not available.', 'warning');
                      }
                    }}
                    style={[styles.callPill, { backgroundColor: C.green + '22', borderColor: C.green }]}
                    activeOpacity={0.7}>
                    <Text style={[styles.callPillTxt, { color: C.green }]}>📞 {t.callDriver}</Text>
                  </TouchableOpacity>
                </View>
                {/* Passenger quick actions — cancel while accepted */}
                {AT.status === 'accepted' && (
                  <PressableScale style={[styles.mainBtn, { backgroundColor: C.red, marginTop: 10 }]} onPress={()=>cancelTrip(AT.id, AT.driver_id)} activeScale={0.94}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.cancelTrip}</Text>
                  </PressableScale>
                )}
                {/* Confirm trip complete when driver has arrived */}
                {AT.status === 'completion_requested' && (
                  <PressableScale style={[styles.mainBtn, { backgroundColor: C.green, marginTop: 10 }]} onPress={passengerConfirmComplete} activeScale={0.95}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>✅ {t.confirmComplete}</Text>
                  </PressableScale>
                )}
                {/* Awaiting driver payment confirmation */}
                {AT.status === 'awaiting_driver_confirm' && (
                  <View style={[styles.statusPill, { backgroundColor: C.greenDim, alignSelf: 'stretch', alignItems: 'center', marginTop: 10 }]}>
                    <Text style={[styles.statusPillTxt, { color: C.green }]}>💰 {t.awaitingDriverConfirm}</Text>
                  </View>
                )}
                <View style={ { height: 8 }} />
              </ScrollView>
            ): (
              destCoords?(
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {/* Service mode toggle: Ride / Delivery */}
                  <View style={styles.serviceModeRow}>
                    {['ride', 'delivery'].map(m => (
                      <TouchableOpacity key={m}
                        style={[styles.serviceModeBtn, serviceMode === m && styles.serviceModeBtnActive]}
                        onPress={()=>setServiceMode(m)}>
                        <Text style={[styles.serviceModeTxt, serviceMode === m && { color: C.gold }]}>
                          {m === 'ride'?'🛵 '+t.rideMode: '📦 '+t.deliveryMode}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Delivery fields */}
                  {serviceMode === 'delivery' && (
                    <View style={styles.deliveryFieldsBox}>
                      <TextInput style={[styles.input, { marginBottom: 8 }]}
                        placeholder={t.packageDesc} placeholderTextColor={C.grayDark}
                        value={packageDesc} onChangeText={setPackageDesc} />
                      <TextInput style={[styles.input, { marginBottom: 8 }]}
                        placeholder={t.recipientName} placeholderTextColor={C.grayDark}
                        value={recipientName} onChangeText={setRecipientName} />
                      <TextInput style={styles.input}
                        placeholder={t.recipientPhone} placeholderTextColor={C.grayDark}
                        value={recipientPhone} onChangeText={setRecipientPhone}
                        keyboardType="phone-pad" />
                    </View>
                  )}

                  {/* Route */}
                  <View style={[styles.routeBlock, { marginTop: 8 }]}>
                    <View style={styles.routeDot} />
                    <Text style={ { color: C.gray, fontSize: 12, flex: 1 }} numberOfLines={1}>
                      {pickupAddress ? `📍 ${pickupAddress}`: state.myLocation ? '📍 Current Location': t.loading}
                    </Text>
                  </View>

                  {/* Multi-stop waypoints */}
                  {stops.map((stop, i)=>(
                    <View key={i}>
                      <View style={styles.routeLine_} />
                      <View style={styles.routeBlock}>
                        <View style={[styles.routeDot, { backgroundColor: C.blue }]} />
                        <Text style={ { color: C.blue, fontSize: 12, flex: 1 }} numberOfLines={1}>
                          {t.stop} {i+1}: {stop.name}
                        </Text>
                        <TouchableOpacity onPress={()=>setStops(s => s.filter((_, j)=>j !== i))}>
                          <Text style={ { color: C.red, fontSize: 12, marginLeft: 8 }}>{t.removeStop}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}

                  <View style={styles.routeLine_} />
                  <View style={styles.routeBlock}>
                    <View style={[styles.routeDot, { backgroundColor: C.green }]} />
                    <Text style={ { color: C.white, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                      {destName}
                    </Text>
                  </View>

                  {/* Add stop button */}
                  <TouchableOpacity style={styles.addStopBtn}
                    onPress={()=> {
                      // Use current search suggestion as a stop before changing destination
                      if (destCoords && destName) {
                        setStops(s => [...s, { name: destName, lat: destCoords.latitude, lng: destCoords.longitude }]);
                        setDestCoords(null); setDestName(''); setSearchQuery('');
                      }
                    }}>
                    <Text style={styles.addStopTxt}>{t.addStop}</Text>
                  </TouchableOpacity>

                  {/* Schedule toggle */}
                  <View style={styles.scheduleModeRow}>
                    {['now',
                      'later'].map(m => (
                        <TouchableOpacity key={m}
                          style={[styles.scheduleBtn, tripMode === m && styles.scheduleBtnActive]}
                          onPress={()=>setTripMode(m)}>
                          <Text style={[styles.scheduleBtnTxt, tripMode === m && { color: C.gold }]}>
                            {m === 'now'?'⚡ '+t.scheduleNow: '📅 '+t.scheduleLater}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>

                  {/* Date/time picker for scheduled rides */}
                  {tripMode === 'later' && (
                    <View style={styles.datePickerBox}>
                      <Text style={ { color: C.gold, fontSize: 13, fontWeight: '800', marginBottom: 12, letterSpacing: 0.5 }}>
                        📅 {t.scheduleDate}
                      </Text>

                      {/* Day selector */}
                      <Text style={ { color: C.gray, fontSize: 11, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>DAY</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ { marginBottom: 14 }}>
                        {Array.from({
                          length: MAX_SCHEDULE_DAYS
                        }, (_, i) => {
                          const d = new Date();
                          d.setDate(d.getDate() + i);
                          d.setHours(0, 0, 0, 0);
                          const sel = scheduledFor && scheduledFor.toDateString() === d.toDateString();
                          return (
                            <TouchableOpacity key={i}
                              style={[styles.timeSlot, { minWidth: 60, marginRight: 8 }, sel && styles.timeSlotActive]}
                              onPress={() => {
                                const updated = scheduledFor ? new Date(scheduledFor): new Date();
                                updated.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                                if (updated <= new Date()) updated.setHours(new Date().getHours() + 1, 0, 0, 0);
                                setScheduledFor(updated);
                              }}>
                              <Text style={[styles.timeSlotDay,
                                sel && { color: C.gold }]}>
                                {i === 0 ? 'Today': i === 1 ? 'Tmrw': d.toLocaleDateString([], {
                                  weekday: 'short'
                                })}
                              </Text>
                              <Text style={[styles.timeSlotTime,
                                { fontSize: 15 },
                                sel && { color: C.gold }]}>
                                {d.getDate()}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      {/* Hour selector */}
                      <Text style={ { color: C.gray, fontSize: 11, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>HOUR</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ { marginBottom: 14 }}>
                        {Array.from({
                          length: 24
                        }, (_,
                          h) => {
                          const sel = scheduledFor && scheduledFor.getHours() === h;
                          const isPast = scheduledFor &&
                          scheduledFor.toDateString() === new Date().toDateString() &&
                          h <= new Date().getHours();
                          return (
                            <TouchableOpacity key={h}
                              style={[styles.timeSlot,
                                { minWidth: 52,
                                  marginRight: 8,
                                  opacity: isPast ? 0.35: 1 },
                                sel && styles.timeSlotActive]}
                              disabled={isPast}
                              onPress={() => {
                                const updated = scheduledFor ? new Date(scheduledFor): new Date();
                                updated.setHours(h, scheduledFor?.getMinutes() || 0, 0, 0);
                                setScheduledFor(updated);
                              }}>
                              <Text style={[styles.timeSlotDay,
                                sel && { color: C.gold }]}>hr</Text>
                              <Text style={[styles.timeSlotTime,
                                sel && { color: C.gold }]}>
                                {h.toString().padStart(2, '0')}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      {/* Minute selector */}
                      <Text style={ { color: C.gray, fontSize: 11, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>MINUTE</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ { marginBottom: 10 }}>
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => {
                          const sel = scheduledFor && scheduledFor.getMinutes() === m;
                          return (
                            <TouchableOpacity key={m}
                              style={[styles.timeSlot,
                                { minWidth: 52,
                                  marginRight: 8 },
                                sel && styles.timeSlotActive]}
                              onPress={() => {
                                const updated = scheduledFor ? new Date(scheduledFor): new Date();
                                updated.setMinutes(m, 0, 0);
                                setScheduledFor(updated);
                              }}>
                              <Text style={[styles.timeSlotDay,
                                sel && { color: C.gold }]}>min</Text>
                              <Text style={[styles.timeSlotTime,
                                sel && { color: C.gold }]}>
                                :{m.toString().padStart(2, '0')}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      {/* Confirmation display */}
                      {scheduledFor && (
                        <View style={ { backgroundColor: C.goldDim, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.gold, flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={ { fontSize: 18, marginRight: 8 }}>📅</Text>
                          <View style={ { flex: 1 }}>
                            <Text style={ { color: C.gold, fontWeight: '900', fontSize: 13 }}>
                              {scheduledFor.toLocaleDateString([],
                                {
                                  weekday: 'long',
                                  day: '2-digit',
                                  month: 'short'
                                })}
                            </Text>
                            <Text style={ { color: C.white, fontWeight: '700', fontSize: 16, marginTop: 2 }}>
                              {scheduledFor.toLocaleTimeString([],
                                {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                            </Text>
                          </View>
                          <TouchableOpacity onPress={() => setScheduledFor(null)} style={ { padding: 4 }}>
                            <Text style={ { color: C.gray, fontSize: 18 }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Surge warning banner */}
                  {surgeActive && (
                    <View style={styles.surgeBanner}>
                      <Text style={styles.surgeBannerTxt}>⚡ {t.surgeActive}</Text>
                      <Text style={styles.surgeBannerSub}>{t.surge1_5x} · {t.surgeReason}</Text>
                    </View>
                  )}

                  <View style={[styles.fareRow, { marginTop: 10 }]}>
                    <View>
                      <Text style={styles.fareAmt}>
                        {fmtFRW(calcFareWithSurge(
                          getDistance(state.myLocation?.latitude,
                            state.myLocation?.longitude,
                            destCoords.latitude,
                            destCoords.longitude),
                          surgeMultiplier
                        ))}
                      </Text>
                      {surgeActive && (
                        <Text style={ { color: C.grayDark, fontSize: 11, textDecorationLine: 'line-through' }}>
                          {fmtFRW(calcFare(getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude)))} base
                        </Text>
                      )}
                    </View>
                    <View style={ { alignItems: 'flex-end', gap: 4 }}>
                      <Text style={styles.fareDist}>
                        {getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude)} km
                      </Text>
                      {/* Estimated trip time — avg moto speed 25 km/h in Kigali */}
                      <View style={{ flexDirection:'row', alignItems:'center', gap:4,
                        backgroundColor: C.greenDim, borderRadius:10, paddingHorizontal:8, paddingVertical:3 }}>
                        <Text style={{ color: C.green, fontSize:11, fontWeight:'700' }}>
                          ⏱ {Math.max(1, Math.round(parseFloat(
                            getDistance(state.myLocation?.latitude, state.myLocation?.longitude,
                              destCoords.latitude, destCoords.longitude)) / 25 * 60))} min
                        </Text>
                      </View>
                      {surgeActive && <View style={styles.surgePill}><Text style={styles.surgePillTxt}>⚡ 1.5×</Text></View>}
                    </View>
                  </View>

                  <View style={styles.payToggleRow}>
                    <Text style={ { color: C.gray, fontSize: 12, marginRight: 6 }}>{t.payWith}:</Text>
                    {[
                      { key: 'cash', label: t.cash, color: C.gray },
                      { key: 'momo', label: t.payWithMTN || '📲 MTN', color: C.mtn },
                      { key: 'airtel', label: t.payWithAirtel || '📲 Airtel', color: C.airtel },
                    ].map(opt => (
                      <TouchableOpacity key={opt.key} onPress={()=>setPaymentMethod(opt.key)}
                        style={[styles.payToggleBtn,
                          paymentMethod === opt.key && {
                            borderColor: opt.color,
                            backgroundColor: opt.color + '20',
                          }]}>
                        <Text style={[styles.payToggleTxt,
                          paymentMethod === opt.key && { color: opt.color }]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Promo code input */}
                  {!promoData ? (
                    <View style={styles.promoRow}>
                      <TextInput
                        style={styles.promoInput}
                        placeholder={t.promoCode}
                        placeholderTextColor={C.grayDark}
                        value={promoCode}
                        onChangeText={v=>setPromoCode(v.toUpperCase())}
                        autoCapitalize="characters"
                        maxLength={12}
                        />
                      <TouchableOpacity
                        style={styles.promoApplyBtn}
                        onPress={()=>applyPromoCode(calcFareWithSurge(
                          getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude),
                          surgeMultiplier
                        ))}
                        disabled={promoLoading||!promoCode.trim()}>
                        {promoLoading
                        ?<ActivityIndicator size="small" color={C.black} />: <Text style={styles.promoApplyTxt}>{t.applyCode}</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  ): (
                    <View style={styles.promoAppliedBanner}>
                      <View style={ { flex: 1 }}>
                        <Text style={styles.promoAppliedTxt}>🎉 {promoData.code}</Text>
                        <Text style={ { color: C.green, fontSize: 12, marginTop: 2 }}>
                          -{fmtFRW(promoData.discount)} {t.promoSaved}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={clearPromo}>
                        <Text style={ { color: C.red, fontSize: 18 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Final price with discount */}
                  {promoData && (
                    <View style={styles.finalPriceRow}>
                      <Text style={ { color: C.gray, fontSize: 13, textDecorationLine: 'line-through' }}>
                        {fmtFRW(calcFareWithSurge(getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude),
                          surgeMultiplier))}
                      </Text>
                      <Text style={[styles.fareAmt, { color: C.green }]}>
                        {fmtFRW(Math.max(0,
                          calcFareWithSurge(getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude), surgeMultiplier) - promoData.discount))}
                      </Text>
                    </View>
                  )}

                  <PressableScale style={styles.mainBtn} onPress={requestRide} disabled={rideLoading} activeScale={0.96}>
                    {rideLoading
                    ?<ActivityIndicator color={C.black} />: <Text style={styles.mainBtnTxt}>🛵 {t.req?.toUpperCase() || 'REQUEST MOTO'}</Text>
                    }
                  </PressableScale>
                </ScrollView>
              ): (
                <View style={ { alignItems: 'center', paddingBottom: 8 }}>
                  <Text style={ { fontSize: 32, marginBottom: 8 }}>🛵</Text>
                  <Text style={styles.hintText}>{t.searchHint}</Text>
                  <Text style={ { color: C.grayDark, fontSize: 11, marginTop: 6, textAlign: 'center' }}>
                    {t.notif_mapPin || '📌 Or long-press on the map to pin a destination.'}
                  </Text>
                </View>
              )
            )
          ): (
            // DRIVER BOTTOM SHEET
            AT?(
              <ScrollView style={ { maxHeight: height * 0.58 }} showsVerticalScrollIndicator={false}>
                {/* ── Prominent active mission banner — shown for all active statuses ── */}
                {['accepted', 'completion_requested', 'awaiting_driver_confirm', 'picked_up'].includes(AT.status) && (
                  <View style={ {
                    backgroundColor: AT.status === 'accepted' ? 'rgba(46,204,113,0.12)' :
                      AT.status === 'awaiting_driver_confirm' ? 'rgba(212,175,55,0.12)' : 'rgba(52,152,219,0.12)',
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: AT.status === 'accepted' ? C.green :
                      AT.status === 'awaiting_driver_confirm' ? C.gold : C.blue,
                    padding: 10,
                    marginBottom: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                  }}>
                    <Text style={ { fontSize: 22 }}>
                      {AT.status === 'accepted' ? '🚦' : AT.status === 'awaiting_driver_confirm' ? '💰' : '🏁'}
                    </Text>
                    <View style={ { flex: 1 }}>
                      <Text style={ { color: AT.status === 'accepted' ? C.green : AT.status === 'awaiting_driver_confirm' ? C.gold : C.blue, fontWeight: '900', fontSize: 13, letterSpacing: 0.5 }}>
                        {AT.status === 'accepted' ? 'ACTIVE MISSION' : AT.status === 'awaiting_driver_confirm' ? 'CONFIRM PAYMENT' : 'TRIP COMPLETION'}
                      </Text>
                      <Text style={ { color: C.offWhite, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{AT.passenger_name || 'Passenger'} · {fmtFRW(AT.price)}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        if (AT.passenger_phone) Linking.openURL(`tel:${AT.passenger_phone}`).catch(() => {});
                        else showBanner('📞 MotoLink', 'Passenger phone not available.', 'warning');
                      }}
                      style={ { backgroundColor: C.green, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={ { color: C.white, fontWeight: '800', fontSize: 11 }}>📞 CALL</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={ { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={styles.jobTitle}>{t.activeJob}</Text>
                  <View style={[styles.statusPill, {
                    backgroundColor: AT.status === 'accepted' ? C.greenDim:
                    AT.status === 'completion_requested' ? C.blueDim:
                    AT.status === 'awaiting_driver_confirm' ? C.goldDim: C.glassLight,
                    marginTop: 0
                  }]}>
                    <Text style={[styles.statusPillTxt, {
                      color: AT.status === 'accepted' ? C.green:
                      AT.status === 'completion_requested' ? C.blue:
                      AT.status === 'awaiting_driver_confirm' ? C.gold: C.gray
                    }]}>
                      {AT.status === 'accepted' ? '🟢 Active':
                      AT.status === 'completion_requested' ? '🏁 Arrived':
                      AT.status === 'awaiting_driver_confirm' ? '💰 Confirm':
                      AT.status === 'picked_up' ? '📦 Picked up':
                      AT.status === 'delivered' ? '✅ Delivered': AT.status}
                    </Text>
                  </View>
                </View>
                {/* Trip type badge */}
                {AT.trip_type === 'delivery' && (
                  <View style={[styles.statusPill, { backgroundColor: C.blueDim, marginTop: 0, marginBottom: 8 }]}>
                    <Text style={[styles.statusPillTxt, { color: C.blue }]}>📦 {t.deliveryMode}</Text>
                  </View>
                )}
                <View style={styles.timestampRow}>
                  <Text style={styles.timestampTxt}>🕐 {t.requestedAt}: {fmtDateTime(AT.created_at)}</Text>
                  {AT.accepted_at && <Text style={[styles.timestampTxt, { color: C.green }]}>✅ {t.acceptedAt}: {fmtTime(AT.accepted_at)}</Text>}
                </View>
                <View style={[styles.routeBlock, { marginTop: 8 }]}><View style={styles.routeDot} /><Text style={ { color: C.gray, fontSize: 12, flex: 1 }} numberOfLines={1}>{AT.pickup_address}</Text></View>
                {/* Show stops */}
                {AT.stops && JSON.parse(AT.stops).map((s, i)=>(
                  <View key={i}>
                    <View style={styles.routeLine_} />
                    <View style={styles.routeBlock}>
                      <View style={[styles.routeDot, { backgroundColor: i < (AT.current_stop_index || 0)?C.green: C.blue }]} />
                      <Text style={ { color: i < (AT.current_stop_index || 0)?C.green: C.blue, fontSize: 11, flex: 1 }} numberOfLines={1}>
                        {i < (AT.current_stop_index || 0)?'✓ ': ''}{t.stop} {i+1}: {s.name}
                      </Text>
                    </View>
                  </View>
                ))}
                <View style={styles.routeLine_} />
                <View style={styles.routeBlock}><View style={[styles.routeDot, { backgroundColor: C.green }]} /><Text style={ { color: C.white, fontSize: 12, fontWeight: '700', flex: 1 }} numberOfLines={1}>{AT.destination_address}</Text></View>
                <View style={[styles.fareRow, { marginTop: 8 }]}>
                  <Text style={styles.fareAmt}>{fmtFRW(AT.price)}</Text>
                  <View style={[styles.statusPill, {
                    backgroundColor: AT.payment_method === 'momo' ? C.goldDim : AT.payment_method === 'airtel' ? 'rgba(255,68,68,0.15)' : C.glassLight,
                    marginTop: 0
                  }]}>
                    <Text style={[styles.statusPillTxt, {
                      color: AT.payment_method === 'momo' ? C.gold : AT.payment_method === 'airtel' ? C.airtel : C.gray
                    }]}>
                      {AT.payment_method === 'momo' ? '📱 MTN MoMo' : AT.payment_method === 'airtel' ? '📱 Airtel' : t.cash}
                    </Text>
                  </View>
                </View>
                {/* Delivery recipient info */}
                {AT.trip_type === 'delivery' && AT.recipient_name && (
                  <View style={styles.driverInfoBox}>
                    <Text style={styles.driverInfoName}>📦 {AT.package_description}</Text>
                    <Text style={ { color: C.gray, fontSize: 12, marginTop: 2 }}>To: {AT.recipient_name} · {AT.recipient_phone}</Text>
                    <TouchableOpacity onPress={()=>Linking.openURL(`tel:${AT.recipient_phone}`)}>
                      <Text style={styles.callBtn}>📞 Call Recipient</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={styles.driverContactRow}>
                  <View>
                    <Text style={ { color: C.gray, fontSize: 11 }}>{t.pax}</Text>
                    <Text style={ { color: C.white, fontWeight: '700', fontSize: 14 }}>{AT.passenger_name || 'Passenger'}</Text>
                    <PassengerRatingBadge passengerId={AT.passenger_id} />
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      if (AT.passenger_phone) Linking.openURL(`tel:${AT.passenger_phone}`).catch(() => {});
                      else showBanner('📞 MotoLink', 'Passenger phone not available.', 'warning');
                    }}
                    style={[styles.callPill, { backgroundColor: C.green + '22', borderColor: C.green }]}
                    activeOpacity={0.7}>
                    <Text style={[styles.callPillTxt, { color: C.green }]}>📞 {t.callPassenger}</Text>
                  </TouchableOpacity>
                </View>
                {/* Driver completion flow */}
                {AT.status === 'accepted' && AT.trip_type !== 'delivery' && (
                  <View style={ { flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <PressableScale style={[styles.mainBtn, { flex: 1, backgroundColor: C.red }]} onPress={()=>cancelTrip(AT.id, AT.passenger_id)} activeScale={0.94}>
                      <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.cancelTrip}</Text>
                    </PressableScale>
                    <PressableScale style={[styles.mainBtn, { flex: 1, backgroundColor: C.blue }]} onPress={requestCompletion} activeScale={0.94}>
                      <Text style={[styles.mainBtnTxt, { color: C.white, fontSize: 12 }]}>{t.arrivedBtn}</Text>
                    </PressableScale>
                  </View>
                )}
                {/* Multi-stop: Mark stop reached */}
                {AT.status === 'accepted' && AT.stops && JSON.parse(AT.stops).length > (AT.current_stop_index || 0) && (
                  <PressableScale style={[styles.mainBtn, { backgroundColor: C.blue, marginTop: 10 }]} onPress={markStopReached} activeScale={0.95}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.markReached}</Text>
                  </PressableScale>
                )}
                {/* Delivery: Picked up / Delivered */}
                {AT.trip_type === 'delivery' && AT.status === 'accepted' && (
                  <View style={ { gap: 8, marginTop: 12 }}>
                    <PressableScale style={[styles.mainBtn, { backgroundColor: C.orange }]} onPress={()=>updateDeliveryStatus('picked_up')} activeScale={0.95}>
                      <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.pickedUp}</Text>
                    </PressableScale>
                  </View>
                )}
                {AT.trip_type === 'delivery' && AT.status === 'picked_up' && (
                  <PressableScale style={[styles.mainBtn, { backgroundColor: C.green, marginTop: 10 }]} onPress={()=>updateDeliveryStatus('delivered')} activeScale={0.95}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.delivered}</Text>
                  </PressableScale>
                )}
                {AT.status === 'completion_requested' && (
                  <View style={[styles.statusPill, { backgroundColor: C.blueDim, alignSelf: 'stretch', alignItems: 'center', marginTop: 12 }]}>
                    <Text style={[styles.statusPillTxt, { color: C.blue }]}>⏳ {t.awaitingPayment}</Text>
                  </View>
                )}
                {AT.status === 'awaiting_driver_confirm' && (
                  <PressableScale style={[styles.mainBtn, { backgroundColor: C.green, marginTop: 12 }]} onPress={driverConfirmPayment} activeScale={0.95}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>💰 {t.driverConfirm}</Text>
                  </PressableScale>
                )}
              </ScrollView>
            ): (
              <>
                {/* Driver tab bar — uses top-level driverTab state, no hook violation */}
                <View style={ { flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingBottom: 8,
                  borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', marginBottom: 6 }}>
                  {[['available', '🛵 ' + t.rideMode], ['scheduled', '📅 ' + (t.scheduledTrip||'Scheduled').replace('📅 ','')]].map(([key, label]) => (
                    <TouchableOpacity key={key} onPress={() => setDriverTab(key)}
                      style={ { flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: 'center',
                        backgroundColor: driverTab === key ? C.goldDim: 'transparent',
                        borderWidth: driverTab === key ? 1: 0, borderColor: C.gold }}>
                      <Text style={ { color: driverTab === key ? C.gold: C.gray, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {driverTab === 'scheduled' ? (
                  <ScheduledTripsPanel
                    role="driver" session={state.session} profile={state.profile}
                    t={t} C={C} styles={styles} fmtFRW={fmtFRW}
                    notify={notify} showBanner={showBanner}
                    getPushToken={getPushToken} sendExpoPush={sendExpoPush}
                    />
                ): (
                  <ScrollView style={ { maxHeight: 290 }} showsVerticalScrollIndicator={false}>
                    {/* ── Driver Online/Offline Toggle ── */}
                    <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:10, backgroundColor:C.card2, borderRadius:14, padding:10, borderWidth:1, borderColor:state.driverOnline?C.green:C.border }}>
                      <View style={{ flex:1 }}>
                        <Text style={{ color:state.driverOnline?C.green:C.gray, fontWeight:'900', fontSize:12, letterSpacing:0.5 }}>
                          {state.driverOnline ? '🟢 ONLINE — Accepting Rides' : '🔴 OFFLINE — Not Visible'}
                        </Text>
                        <Text style={{ color:C.grayDark, fontSize:10, marginTop:2 }}>
                          {state.driverOnline ? 'Passengers can find you' : 'You won\'t receive requests'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => dispatch({ type:'SET_DRIVER_ONLINE', p:!state.driverOnline })}
                        style={{ width:48, height:26, borderRadius:13, backgroundColor:state.driverOnline?C.green:C.grayDark, justifyContent:'center', paddingHorizontal:2 }}>
                        <Animated.View style={{ width:22, height:22, borderRadius:11, backgroundColor:C.white, alignSelf:state.driverOnline?'flex-end':'flex-start', shadowColor:'#000', shadowOpacity:0.2, shadowRadius:2, elevation:2 }} />
                      </TouchableOpacity>
                    </View>
                    <View style={ { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.jobTitle}>📋 {t.availJobs} ({state.driverOnline ? state.availableTrips.length : 0})</Text>
                      <TouchableOpacity style={styles.leaderboardBtn}
                        onPress={()=> { loadLeaderboard(); setShowLeaderboard(true); }}>
                        <Text style={styles.leaderboardBtnTxt}>🏆</Text>
                      </TouchableOpacity>
                    </View>
                    {!state.profile?.momo_name && (
                      <TouchableOpacity style={[styles.outlineBtn, { borderColor: C.orange, marginBottom: 12 }]} onPress={()=>setPaySetupModal(true)}>
                        <Text style={[styles.outlineBtnTxt, { color: C.orange }]}>⚠️ {t.noPaymentWarning}</Text>
                      </TouchableOpacity>
                    )}
                    {(!state.driverOnline) && <View style={{ backgroundColor:C.redDim, borderRadius:12, padding:12, marginBottom:8, borderWidth:1, borderColor:C.red }}><Text style={{ color:C.red, textAlign:'center', fontSize:12, fontWeight:'700' }}>You are offline. Toggle above to receive ride requests.</Text></View>}
                    {state.driverOnline && state.availableTrips.length === 0 && <Text style={styles.hintText}>{t.scanJobs}</Text>}
                    {state.driverOnline && state.availableTrips.map(j => (
                      <View key={j.id} style={styles.jobCard}>
                        <View style={ { flex: 1 }}>
                          <View style={ { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <View style={ { flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <Text style={styles.jobPrice}>{fmtFRW(j.price)}</Text>
                              {surgeActive && <View style={styles.surgePill}><Text style={styles.surgePillTxt}>⚡ 1.5×</Text></View>}
                              {j.trip_type === 'delivery' && <View style={[styles.surgePill, { backgroundColor: C.blueDim, borderColor: C.blue }]}><Text style={[styles.surgePillTxt, { color: C.blue }]}>📦</Text></View>}
                              {j.is_scheduled && <View style={[styles.surgePill, { backgroundColor: C.purpleDim, borderColor: C.purple }]}><Text style={[styles.surgePillTxt, { color: C.purple }]}>📅</Text></View>}
                            </View>
                            <View style={ { flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                              <View style={[styles.statusPill, {
                                backgroundColor: j.payment_method === 'momo' ? C.goldDim : j.payment_method === 'airtel' ? 'rgba(255,68,68,0.15)' : C.glassLight,
                                marginTop: 0, paddingVertical: 2
                              }]}>
                                <Text style={[styles.statusPillTxt, {
                                  color: j.payment_method === 'momo' ? C.gold : j.payment_method === 'airtel' ? C.airtel : C.gray
                                }]}>
                                  {j.payment_method === 'momo' ? '📱 MTN MoMo' : j.payment_method === 'airtel' ? '📱 Airtel' : t.cash}
                                </Text>
                              </View>
                              <Text style={styles.timestampTxt}>🕐 {fmtTime(j.created_at)}</Text>
                            </View>
                          </View>
                          {/* Scheduled time */}
                          {j.is_scheduled && j.scheduled_for && (
                            <Text style={ { color: C.purple,
                              fontSize: 11,
                              fontWeight: '700',
                              marginBottom: 4 }}>
                              📅 {t.scheduledFor}: {new Date(j.scheduled_for).toLocaleDateString([], {
                                day: '2-digit', month: 'short'
                              })} · {new Date(j.scheduled_for).toLocaleTimeString([], {
                                hour: '2-digit', minute: '2-digit'
                              })}
                            </Text>
                          )}
                          <View style={styles.routeBlock}><View style={styles.routeDot} /><Text style={ { color: C.gray, fontSize: 11, flex: 1 }} numberOfLines={1}>{j.pickup_address}</Text></View>
                          {/* Show stops count */}
                          {j.stops && JSON.parse(j.stops).length > 0 && (
                            <Text style={ { color: C.blue,
                              fontSize: 10,
                              marginLeft: 16,
                              marginTop: 2 }}>+ {JSON.parse(j.stops).length} {t.stops}</Text>
                          )}
                          <View style={styles.routeLine_} />
                          <View style={styles.routeBlock}><View style={[styles.routeDot, { backgroundColor: C.green }]} /><Text style={ { color: C.offWhite, fontSize: 11, flex: 1 }} numberOfLines={1}>{j.destination_address}</Text></View>
                          <View style={ { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <Text style={ { color: C.gray, fontSize: 11 }}>👤 {j.passenger_name || 'Passenger'}</Text>
                            <PassengerRatingBadge passengerId={j.passenger_id} />
                          </View>
                        </View>
                        <View style={ { gap: 6 }}>
                          <PressableScale onPress={()=>acceptTrip(j)} style={styles.acceptBtn} activeScale={0.92}>
                            <Text style={styles.acceptBtnTxt}>{t.acceptBtnLabel || 'ACCEPT'}</Text>
                          </PressableScale>
                          {j.is_scheduled&&!j.pre_accepted_by && (
                            <TouchableOpacity onPress={()=>preAcceptScheduledTrip(j.id)}
                              style={[styles.acceptBtn,
                                { backgroundColor: 'transparent',
                                  borderWidth: 1,
                                  borderColor: C.purple }]}>
                              <Text style={[styles.acceptBtnTxt,
                                { color: C.purple }]}>PRE</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </>
            )
          )}
        </View>
      </View>
    );
  }


  // ══════════════════════════════════════════════════════
  // SCHEDULED TRIPS PANEL — UPGRADE: full route, pre-accept, close buttons
  // ══════════════════════════════════════════════════════
  function ScheduledTripsPanel( {
    role, session, profile, t, C, styles, fmtFRW, notify, showBanner, getPushToken, sendExpoPush
  }) {
    const [trips, setTrips] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(null);
    const [actionLoading, setActionLoading] = useState(null);

    const loadTrips = async () => {
      if (!session?.user?.id) return;
      setLoading(true);
      try {
        let q;
        if (role === 'passenger') {
          const nowIso = new Date().toISOString();
          q = supabase.from('trips').select('*')
          .eq('passenger_id', session.user.id).eq('is_scheduled', true)
          .in('status', ['scheduled', 'searching', 'accepted'])
          .gte('scheduled_for', nowIso) // only show upcoming, not expired
          .order('scheduled_for', {
            ascending: true
          });
        } else {
          const now = new Date().toISOString();
          const soon = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // next 48h
          q = supabase.from('trips').select('*')
          .eq('is_scheduled', true).in('status', ['scheduled', 'searching'])
          .gte('scheduled_for', now).lte('scheduled_for', soon)
          .order('scheduled_for', {
            ascending: true
          });
        }
        const {
          data,
          error
        } = await q;
        if (!error) setTrips(data || []);
      } catch {}
      setLoading(false);
    };

    useEffect(() => {
      loadTrips();
      const ch = supabase.channel('sched_' + role + '_' + (session?.user?.id || ''))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'trips'
      }, loadTrips)
      .subscribe();
      return () => supabase.removeChannel(ch);
    }, [session?.user?.id, role]);

    const preAccept = async (trip) => {
      // Allow Airtel-only drivers too
      if (!profile?.momo_number && !profile?.momo_merchant_code && !profile?.airtel_number) {
        showBanner && showBanner('⚠️ Payment', t.noPaymentWarning, 'warning');
        return;
      }
      if (trip.pre_accepted_by) {
        showBanner && showBanner('⚠️ MotoLink', 'This trip has already been reserved.', 'warning');
        return;
      }
      setActionLoading(trip.id);
      const {
        error
      } = await supabase.from('trips').update({
          pre_accepted_by: session.user.id,
          driver_id: session.user.id,
          driver_name: profile?.name || 'Driver',
          driver_phone: session.user.phone,
        }).eq('id', trip.id).is('pre_accepted_by', null);
      setActionLoading(null);
      if (!error) {
        loadTrips();
        showBanner && showBanner('✋ ' + (t.preAccepted || 'Pre-Accepted'), `${trip.pickup_address} → ${trip.destination_address}`, 'accepted');
        // Push notification to passenger
        if (trip.passenger_id && getPushToken && sendExpoPush) {
          const tk = await getPushToken(trip.passenger_id);
          await sendExpoPush(
            tk,
            '✋ ' + (t.preAccepted || 'Driver Reserved'),
            `${profile?.name || 'A driver'} reserved your scheduled trip.`,
            {
              type: 'accepted'
            }
          );
        }
      } else {
        showBanner && showBanner('⚠️ MotoLink', 'Trip may have been taken. Refresh.', 'error');
      }
    };

    const cancelPreAccept = async (tripId) => {
      setActionLoading(tripId);
      await supabase.from('trips').update({
        pre_accepted_by: null, driver_id: null, driver_name: null, driver_phone: null,
      }).eq('id', tripId);
      setActionLoading(null);
      loadTrips();
      showBanner && showBanner('↩️ MotoLink', t.preAcceptCancel || 'Pre-accept cancelled.', 'warning');
    };

    const cancelSched = async (tripId, passengerId) => {
      setActionLoading(tripId);
      await supabase.from('trips').update({
        status: 'cancelled', cancelled_at: new Date().toISOString()
      }).eq('id', tripId);
      setTrips(prev => prev.filter(x => x.id !== tripId));
      setActionLoading(null);
      showBanner && showBanner('❌ MotoLink', t.cancelledAt || 'Trip cancelled.', 'cancelled');
      if (passengerId && getPushToken && sendExpoPush) {
        const tk = await getPushToken(passengerId);
        await sendExpoPush(tk, '❌ ' + (t.cancel || 'Cancelled'), t.cancelledAt || 'Your scheduled trip was cancelled.', {
          type: 'cancelled'
        });
      }
    };

    const dismissCard = (tripId) => setTrips(prev => prev.filter(x => x.id !== tripId));

    const timeUntil = (iso) => {
      const ms = new Date(iso) - new Date();
      if (ms < 0) return 'Now';
      const h = Math.floor(ms / 3600000),
      m = Math.floor((ms % 3600000) / 60000);
      return h > 0 ? h + 'h ' + m + 'm': m + 'm';
    };

    const urgColor = (iso) => {
      const ms = new Date(iso) - new Date();
      return ms < 15 * 60 * 1000 ? '#FF4C4C': ms < 60 * 60 * 1000 ? '#F39C12': '#9B59B6';
    };

    const fmtSchedTime = (iso) => {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleDateString([], {
        weekday: 'short', day: '2-digit', month: 'short'
      }) +
      ' · ' + d.toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit'
      });
    };

    if (loading) return (
      <View style={ { padding: 20, alignItems: 'center' }}>
        <ActivityIndicator color={C.gold} size="small" />
        <Text style={ { color: C.gray, fontSize: 12, marginTop: 6 }}>Loading...</Text>
      </View>
    );

    if (trips.length === 0) return (
      <View style={ { padding: 20, alignItems: 'center' }}>
        <Text style={ { fontSize: 28 }}>📅</Text>
        <Text style={ { color: C.gray, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
          {role === 'passenger'
          ? 'No scheduled trips.\nUse "Schedule for Later" when booking.': 'No open scheduled trips in the next 48h.'}
        </Text>
      </View>
    );

    return (
      <ScrollView style={ { maxHeight: 400 }} showsVerticalScrollIndicator={false}>
        {trips.map(trip => {
          const urg = urgColor(trip.scheduled_for);
          const isOpen = expanded === trip.id;
          const isMyPreAccept = trip.pre_accepted_by === session?.user?.id;
          const isLoading = actionLoading === trip.id;

          return (
            <View key={trip.id} style={[styles.tripCard, {
              borderLeftWidth: 3, borderLeftColor: urg, marginBottom: 8, position: 'relative'
            }]}>
              {/* ── UPGRADE: ❌ dismiss button on each card ── */}
              <TouchableOpacity
                onPress={() => dismissCard(trip.id)}
                style={ {
                  position: 'absolute', top: 6, right: 6, zIndex: 10,
                  width: 24, height: 24, borderRadius: 12,
                  backgroundColor: 'rgba(255,76,76,0.15)',
                  justifyContent: 'center', alignItems: 'center',
                }}
                hitSlop={ { top: 8, bottom: 8, left: 8, right: 8 }}
                >
                <Text style={ { color: C.red, fontSize: 12, fontWeight: '900' }}>✕</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setExpanded(isOpen ? null: trip.id)} activeOpacity={0.75}>
                {/* ── UPGRADE: Header with countdown ── */}
                <View style={ { flexDirection: 'row', alignItems: 'center', marginBottom: 6, paddingRight: 28 }}>
                  <View style={ { flex: 1 }}>
                    <View style={ { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <View style={ { backgroundColor: urg + '22', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={ { fontSize: 11, fontWeight: '900', color: urg }}>⏰ {timeUntil(trip.scheduled_for)}</Text>
                      </View>
                      <Text style={ { fontSize: 10, color: C.gray }}>{fmtSchedTime(trip.scheduled_for)}</Text>
                    </View>
                    <Text style={ { color: C.gold, fontWeight: '900', fontSize: 13 }}>{fmtFRW(trip.final_price || trip.price)}</Text>
                  </View>
                  <Text style={ { color: C.gray, fontSize: 14 }}>{isOpen ? '▲': '▼'}</Text>
                </View>

                {/* ── UPGRADE: Full From→To route display ── */}
                <View style={ { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 10, marginBottom: 6 }}>
                  {/* FROM */}
                  <View style={ { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
                    <View style={ { width: 10, height: 10, borderRadius: 5, backgroundColor: C.gold, marginTop: 3, marginRight: 8, flexShrink: 0 }} />
                    <View style={ { flex: 1 }}>
                      <Text style={ { color: C.gray, fontSize: 9, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 1 }}>{t.from || 'FROM'}</Text>
                      <Text style={ { color: C.offWhite, fontSize: 12, fontWeight: '600' }} numberOfLines={2}>{trip.pickup_address || '—'}</Text>
                    </View>
                  </View>
                  {/* Route line */}
                  <View style={ { width: 1, height: 12, backgroundColor: C.border, marginLeft: 4, marginBottom: 6 }} />
                  {/* TO */}
                  <View style={ { flexDirection: 'row', alignItems: 'flex-start' }}>
                    <View style={ { width: 10, height: 10, borderRadius: 5, backgroundColor: C.green, marginTop: 3, marginRight: 8, flexShrink: 0 }} />
                    <View style={ { flex: 1 }}>
                      <Text style={ { color: C.gray, fontSize: 9, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 1 }}>{t.to || 'TO'}</Text>
                      <Text style={ { color: C.white, fontSize: 12, fontWeight: '700' }} numberOfLines={2}>{trip.destination_address || '—'}</Text>
                    </View>
                  </View>
                </View>

                {/* Pre-accept status */}
                {trip.pre_accepted_by && (
                  <View style={[styles.statusPill, { backgroundColor: '#9B59B622', marginTop: 4 }]}>
                    <Text style={[styles.statusPillTxt, { color: '#9B59B6' }]}>
                      ✋ {role === 'passenger'
                      ? `${t.preAcceptedBy || 'Reserved by'}: ${trip.driver_name || 'Driver'}`: (isMyPreAccept ? (t.preAccepted || 'Pre-accepted by you'): `Reserved by ${trip.driver_name || 'Another driver'}`)}
                    </Text>
                  </View>
                )}

                {/* ── Always-visible quick contact row for passenger once driver reserved ── */}
                {role === 'passenger' && trip.pre_accepted_by && trip.driver_phone && (
                  <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginTop:8, backgroundColor:'rgba(212,175,55,0.06)', borderRadius:10, padding:10, borderWidth:1, borderColor:C.border }}>
                    <View style={{ flex:1 }}>
                      <Text style={{ color:C.gray, fontSize:9, fontWeight:'800', letterSpacing:0.5 }}>🏍️ {t.driver || 'DRIVER'}</Text>
                      <Text style={{ color:C.white, fontWeight:'800', fontSize:13, marginTop:1 }}>{trip.driver_name || 'Driver'}</Text>
                      <Text style={{ color:C.gold, fontSize:12, fontWeight:'700', marginTop:2 }}>📞 {trip.driver_phone}</Text>
                    </View>
                    <View style={{ flexDirection:'row', gap:6 }}>
                      <TouchableOpacity
                        onPress={() => Linking.openURL(`tel:${trip.driver_phone}`)}
                        style={{ backgroundColor:'rgba(212,175,55,0.15)', borderRadius:10, paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderColor:C.gold, flexDirection:'row', alignItems:'center', gap:5 }}>
                        <Text style={{ fontSize:14 }}>📞</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => Linking.openURL(`https://wa.me/${trip.driver_phone.replace(/\D/g,'')}`)}
                        style={{ backgroundColor:'rgba(37,211,102,0.1)', borderRadius:10, paddingHorizontal:12, paddingVertical:8, borderWidth:1, borderColor:'#25D166', flexDirection:'row', alignItems:'center', gap:5 }}>
                        <Text style={{ fontSize:14 }}>💬</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </TouchableOpacity>

              {/* ── UPGRADE: Expanded section with full info + actions ── */}
              {isOpen && (
                <View style={ { marginTop: 10, borderTopWidth: 1, borderTopColor: C.borderFaint, paddingTop: 10, gap: 8 }}>
                  {/* ── Contact info (visible after pre-accept or accepted) ── */}
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start', gap: 8 }}>
                    <View style={{ flex:1 }}>
                      <Text style={{ color:C.gray, fontSize:10, marginBottom:3, letterSpacing:0.5, fontWeight:'700' }}>
                        {role === 'driver' ? '👤 PASSENGER' : '🏍️ DRIVER'}
                      </Text>
                      <Text style={{ color:C.white, fontWeight:'800', fontSize:13 }}>
                        {role === 'driver'
                          ? (trip.passenger_name || 'Passenger')
                          : (trip.driver_name || (trip.pre_accepted_by ? 'Driver assigned' : 'No driver yet'))}
                      </Text>
                      {/* Phone number — shown when trip has a pre-accepted driver or is accepted */}
                      {(trip.pre_accepted_by || trip.status === 'accepted') && (
                        <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700', marginTop: 2 }}>
                          📞 {role === 'driver'
                            ? (trip.passenger_phone || 'N/A')
                            : (trip.driver_phone || 'N/A')}
                        </Text>
                      )}
                    </View>
                    {/* Quick contact buttons — shown after pre-accept */}
                    {(trip.pre_accepted_by || trip.status === 'accepted') && (
                      <View style={{ gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => {
                            const phone = role === 'driver' ? trip.passenger_phone : trip.driver_phone;
                            if (phone) Linking.openURL(`tel:${phone}`);
                          }}
                          style={{ backgroundColor:'rgba(212,175,55,0.15)', borderRadius:10, paddingHorizontal:12, paddingVertical:7, borderWidth:1, borderColor:C.gold, flexDirection:'row', alignItems:'center', gap:5 }}>
                          <Text style={{ fontSize:13 }}>📞</Text>
                          <Text style={{ color:C.gold, fontWeight:'800', fontSize:11 }}>Call</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            const phone = (role === 'driver' ? trip.passenger_phone : trip.driver_phone)?.replace(/\D/g,'');
                            if (phone) Linking.openURL(`https://wa.me/${phone}`);
                          }}
                          style={{ backgroundColor:'rgba(37,211,102,0.1)', borderRadius:10, paddingHorizontal:12, paddingVertical:7, borderWidth:1, borderColor:'#25D166', flexDirection:'row', alignItems:'center', gap:5 }}>
                          <Text style={{ fontSize:13 }}>💬</Text>
                          <Text style={{ color:'#25D166', fontWeight:'800', fontSize:11 }}>WhatsApp</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  <View style={{ alignItems:'flex-end' }}>
                    <Text style={{ color:C.gray, fontSize:10, marginBottom:2 }}>💳 {t.payWith || 'Payment'}</Text>
                    <Text style={{ color: trip.payment_method === 'momo' ? C.mtn : trip.payment_method === 'airtel' ? C.airtel : C.gray, fontWeight:'700', fontSize:12 }}>
                      {trip.payment_method === 'momo' ? '📱 MTN MoMo' : trip.payment_method === 'airtel' ? '📱 Airtel' : '💵 Cash'}
                    </Text>
                  </View>

                  {/* Fare breakdown */}
                  <View style={ { backgroundColor: C.card2, borderRadius: 10, padding: 10 }}>
                    <View style={ { flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={ { color: C.gray, fontSize: 11 }}>Base fare</Text>
                      <Text style={ { color: C.white, fontWeight: '700', fontSize: 11 }}>{fmtFRW(trip.price || 0)}</Text>
                    </View>
                    {trip.discount_amount > 0 && (
                      <View style={ { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                        <Text style={ { color: C.green, fontSize: 11 }}>🎉 Promo</Text>
                        <Text style={ { color: C.green, fontWeight: '700', fontSize: 11 }}>-{fmtFRW(trip.discount_amount)}</Text>
                      </View>
                    )}
                    <View style={ { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, borderTopWidth: 1, borderTopColor: C.borderFaint, paddingTop: 6 }}>
                      <Text style={ { color: C.gold, fontSize: 12, fontWeight: '900' }}>Total</Text>
                      <Text style={ { color: C.gold, fontSize: 13, fontWeight: '900' }}>{fmtFRW(trip.final_price || trip.price || 0)}</Text>
                    </View>
                  </View>

                  {/* Actions — Driver */}
                  {role === 'driver' && !trip.pre_accepted_by && (
                    <TouchableOpacity
                      onPress={() => preAccept(trip)}
                      disabled={isLoading}
                      style={[styles.acceptBtn, { backgroundColor: '#9B59B6' }]}
                      >
                      {isLoading
                      ? <ActivityIndicator color="#fff" size="small" />: <Text style={styles.acceptBtnTxt}>✋ {t.preAccept || 'PRE-ACCEPT TRIP'}</Text>}
                    </TouchableOpacity>
                  )}
                  {role === 'driver' && isMyPreAccept && (
                    <View style={ { gap: 6 }}>
                      <View style={[styles.statusPill, { backgroundColor: '#9B59B622', alignSelf: 'stretch', alignItems: 'center' }]}>
                        <Text style={[styles.statusPillTxt, { color: '#9B59B6' }]}>✋ {t.preAccepted || 'You pre-accepted this trip'}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => cancelPreAccept(trip.id)}
                        disabled={isLoading}
                        style={[styles.outlineBtn, { borderColor: C.red, paddingVertical: 10 }]}
                        >
                        <Text style={[styles.outlineBtnTxt, { color: C.red, fontSize: 12 }]}>
                          {isLoading ? '...': (t.preAcceptCancel || 'Cancel Pre-Accept')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {role === 'driver' && trip.pre_accepted_by && !isMyPreAccept && (
                    <View style={[styles.statusPill, { backgroundColor: C.redDim, alignSelf: 'stretch', alignItems: 'center' }]}>
                      <Text style={[styles.statusPillTxt, { color: C.red }]}>🔒 Reserved by {trip.driver_name || 'another driver'}</Text>
                    </View>
                  )}

                  {/* Actions — Passenger */}
                  {role === 'passenger' && (
                    <TouchableOpacity
                      onPress={() => cancelSched(trip.id, null)}
                      disabled={isLoading}
                      style={[styles.outlineBtn, { borderColor: C.red, paddingVertical: 10 }]}
                      >
                      <Text style={[styles.outlineBtnTxt, { color: C.red, fontSize: 12 }]}>
                        {isLoading ? '...': '❌ ' + (t.cancelTrip || 'Cancel')}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* ❌ Collapse button */}
                  <TouchableOpacity
                    onPress={() => setExpanded(null)}
                    style={ { alignItems: 'center', paddingVertical: 4 }}
                    >
                    <Text style={ { color: C.gray, fontSize: 11 }}>▲ {t.close || 'Close'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    );
  }


  // ══════════════════════════════════════════════
  // AI CHAT COMPONENT — MotoLink Assistant
  // Gemini-powered, language-adaptive, premium UI
  // ══════════════════════════════════════════════
  // ── MotoLink AI — powered by Claude (Anthropic) ───────────────────────────

  const AIChatModal = ({
    visible, onClose, profile, lang, role, onAction
  }) => {
    const t = LANG[lang] || LANG.en;
    const userName = profile?.name?.split(' ')[0] || (lang === 'rw' ? 'Mugenzi': lang === 'fr' ? 'Ami': 'Friend');

    const GREETINGS = {
      en: role === 'driver'
      ? `Hey ${userName}! 🏍️ I'm MotoLink AI. I can help you maximise earnings, check peak hours, manage payments, navigate the leaderboard, and more. What's on your mind?`
      : `Hello ${userName}! 👋 I'm your MotoLink AI assistant. I can help you book rides, check fares, track your trips, schedule a ride, and more. Just ask — or say "book a ride to Remera"!`,
      rw: role === 'driver'
      ? `Mwiriwe ${userName}! 🏍️ Ndi MotoLink AI. Nshobora kukugufasha kwiyongera inyungu, kureba amasaa meza yo gukora, gucunga ubwishyu, kureba urutonde, n'ibindi. Ni iki ushaka kumenya?`
      : `Muraho ${userName}! 👋 Ndi umufasha wa MotoLink AI. Nshobora kukugufasha gufata inzira, gusobanukirwa ibiciro, guteganya urugendo, n'ibindi. Baza — cyangwa vuga ngo "mfate inzira ujya Remera"!`,
      fr: role === 'driver'
      ? `Bonjour ${userName}! 🏍️ Je suis MotoLink IA. Je peux vous aider à maximiser vos gains, gérer les paiements, consulter le classement, et bien plus. Que souhaitez-vous?`
      : `Bonjour ${userName}! 👋 Je suis votre assistant MotoLink IA. Je peux vous aider à réserver, vérifier les tarifs, planifier un trajet, et plus encore. Dites simplement "réserver un trajet vers Remera"!`,
    };

    const SYSTEM_PROMPT = role === 'driver'
    ? `You are MotoLink AI — an intelligent, friendly in-app assistant for DRIVERS on MotoLink, Rwanda's premium motorcycle ride-hailing app based in Kigali.

You are genuinely smart and helpful. You can answer ANY question the driver asks — not just app-related ones. If they ask about weather, Kigali news, motorcycle maintenance, health, business advice, or anything else, answer it thoroughly and helpfully. Don't limit yourself to a script.

IMPORTANT — IN-APP ACTIONS: For app-specific requests, include ONE JSON action block at the END of your reply:
ACTION:{"type":"OPEN_PAYMENT_SETUP"} — open payment setup
ACTION:{"type":"OPEN_EARNINGS"} — open earnings dashboard
ACTION:{"type":"OPEN_HISTORY"} — open trip history
ACTION:{"type":"OPEN_LEADERBOARD"} — open leaderboard

MotoLink app knowledge for drivers:
- Accept ride requests on the map; earn money per trip
- Peak hours: 7–9 AM and 5–8 PM give 1.5x surge earnings
- Busy zones in Kigali: Kimironko, Remera, CBD, Nyabugogo, Gisozi, Kacyiru
- Leaderboard: top drivers by trips and rating get bonuses
- Payment: drivers receive via MTN MoMo (*182*1*1*...), Airtel Money, MTN merchant (*182*8*1*...)
  - Cross-network: passenger MTN → driver Airtel: *182*1*2*{airtel}*amount#
  - Cross-network: passenger Airtel → driver MTN: *182*1*2*{momo}*amount#
- Set up both MTN and Airtel accounts in payment setup for more passengers
- Commission: 10% platform fee on each trip
- Scheduled trips: pre-accept upcoming trips to guarantee income; fare locked at booking time (no surge for scheduled trips)
- SOS button for emergencies
- Package delivery: multi-stop jobs available
- Speed monitoring: stay under 60 km/h in city, 80 km/h on highways

Driver name: ${userName}. Language preference: ${lang}.
Always reply in the same language the driver is writing in. If they write Kinyarwanda, respond in Kinyarwanda. French → French. English → English. Mixed? Match their dominant language.
Be direct, warm, and practical. Use emojis appropriately. Keep responses concise but complete.`
    : `You are MotoLink AI — an intelligent, friendly in-app assistant for PASSENGERS on MotoLink, Rwanda's premium motorcycle ride-hailing app based in Kigali.

You are genuinely smart and helpful. You can answer ANY question — not just app-related ones. If a passenger asks about Kigali restaurants, directions, news, health, business, or anything else, answer it helpfully. Don't restrict yourself.

IMPORTANT — IN-APP ACTIONS: For app-specific requests, include ONE JSON action block at the END of your reply:
ACTION:{"type":"SEARCH_DESTINATION","destination":"Kimironko"} — search for a destination
ACTION:{"type":"BOOK_RIDE_NOW","destination":"Remera"} — book a ride immediately
ACTION:{"type":"SCHEDULE_RIDE","destination":"Airport"} — schedule a ride
ACTION:{"type":"SET_DELIVERY_MODE","destination":"Kacyiru"} — switch to delivery mode
ACTION:{"type":"SET_PAYMENT_MOMO"} — set payment to MTN MoMo
ACTION:{"type":"SET_PAYMENT_AIRTEL"} — set payment to Airtel Money
ACTION:{"type":"SET_PAYMENT_CASH"} — set payment to Cash
ACTION:{"type":"OPEN_SCHEDULE"} — open scheduled trips
ACTION:{"type":"OPEN_HISTORY"} — open trip history

INTENT DETECTION — recognise these naturally:
- "take me to X", "ntwara X", "njye X", "book to X" → BOOK_RIDE_NOW with X
- "later/tomorrow/tonight/at Xpm to Y" → SCHEDULE_RIDE with Y
- "send/deliver/kohereza to X" → SET_DELIVERY_MODE with X
- "pay with MoMo/MTN/ishyura MoMo" → SET_PAYMENT_MOMO
- "pay Airtel/ishyura Airtel" → SET_PAYMENT_AIRTEL
- "cash/amafaranga" → SET_PAYMENT_CASH

MotoLink app knowledge:
- Fares: 500 FRW base (<1km), 700 FRW (1–2km), +200 FRW per km. Surge 1.5x during 7–9AM & 5–8PM
- Scheduled trips: fare is LOCKED at booking time — no surge applies when the trip runs
- Payment: MTN MoMo, Airtel Money, or Cash. USSD auto-dialled from the app
  MTN→MTN: *182*1*1*{number}*amount# | MTN→Airtel: *182*1*2*{airtel}*amount#
  Airtel→Airtel: *182*1*1*{airtel}*amount# | Airtel→MTN: *182*1*2*{momo}*amount#
- Safety: SOS button shares location + emergency contact
- Saved places: save Home, Work, and favourite spots for instant booking
- Promos: enter promo codes at booking for discounts
- Trip sharing: share live trip link with family/friends

Passenger name: ${userName}. Language preference: ${lang}.
Always reply in the same language the passenger is writing in. Match their language naturally — Kinyarwanda, French, or English.
Be warm, helpful, and clear. Use emojis naturally. Keep answers concise but genuinely useful.`;

    const [messages,
      setMessages] = useState([{
        role: 'assistant', text: GREETINGS[lang] || GREETINGS.en, id: 'greeting'
      }]);
    const [inputText,
      setInputText] = useState('');
    const [isTyping,
      setIsTyping] = useState(false);
    const [dotAnim] = useState(new Animated.Value(0));
    const [slideAnim] = useState(new Animated.Value(height));
    const [fadeAnim] = useState(new Animated.Value(0));
    const scrollRef = useRef(null);
    const inputRef = useRef(null);

    const hasOpened = useRef(false);

    // Entrance animation — no lang dependency to prevent re-flash on language change
    useEffect(() => {
      if (visible) {
        // Only reset messages the very first time modal opens each session
        if (!hasOpened.current) {
          hasOpened.current = true;
          setMessages([{ role: 'assistant', text: GREETINGS[lang] || GREETINGS.en, id: 'greeting' }]);
        }
        Animated.parallel([
          Animated.spring(slideAnim, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }),
          Animated.timing(fadeAnim, { toValue: 1, duration: 260, useNativeDriver: true }),
        ]).start();
      } else {
        Animated.parallel([
          Animated.timing(slideAnim, { toValue: height, duration: 300, useNativeDriver: true }),
          Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => { hasOpened.current = false; });
      }
    }, [visible]);

    // Typing dots animation
    useEffect(() => {
      if (!isTyping) {
        dotAnim.setValue(0); return;
      }
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, {
            toValue: 1, duration: 500, useNativeDriver: true
          }),
          Animated.timing(dotAnim, {
            toValue: 0, duration: 500, useNativeDriver: true
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    },
      [isTyping]);

    // Message bubble entrance animation helper
    const MessageBubble = ({
      msg,
      index
    }) => {
      const [bubAnim] = useState(new Animated.Value(0));
      const isAI = msg.role === 'assistant';
      useEffect(() => {
        Animated.spring(bubAnim, {
          toValue: 1, friction: 8, tension: 90, useNativeDriver: true, delay: 60
        }).start();
      },
        []);
      return (
        <Animated.View style={ {
          opacity: bubAnim,
          transform: [{ translateY: bubAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
            { scale: bubAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
          alignSelf: isAI ? 'flex-start': 'flex-end',
          maxWidth: '82%',
          marginBottom: 10,
        }}>
          {isAI && (
            <View style={ { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 6 }}>
              <View style={ { width: 22, height: 22, borderRadius: 11, backgroundColor: C.goldDim, borderWidth: 1, borderColor: C.gold, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={ { fontSize: 12 }}>🏍️</Text>
              </View>
              <Text style={ { color: C.grayDark, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>MOTOLINK AI</Text>
            </View>
          )}
          <View style={ {
            backgroundColor: isAI ? C.card2: C.goldDim,
            borderRadius: isAI ? 18: 18,
            borderTopLeftRadius: isAI ? 4: 18,
            borderTopRightRadius: isAI ? 18: 4,
            padding: 13,
            borderWidth: 1,
            borderColor: isAI ? C.borderFaint: C.border,
            shadowColor: isAI ? '#000': C.gold,
            shadowOffset: { width: 0,
              height: 2 },
            shadowOpacity: isAI ? 0.25: 0.2,
            shadowRadius: 8,
            elevation: 4,
          }}>
            <Text style={ { color: isAI ? C.white: C.black,
              fontSize: 14,
              lineHeight: 21,
              fontWeight: isAI ? '400': '600' }}>
              {msg.text}
            </Text>
          </View>
          <Text style={ { color: C.grayDark,
            fontSize: 9,
            marginTop: 3,
            marginHorizontal: 4,
            alignSelf: isAI ? 'flex-start': 'flex-end' }}>
            {new Date().toLocaleTimeString([], {
              hour: '2-digit', minute: '2-digit'
            })}
          </Text>
        </Animated.View>
      );
    };

    const sendMessage = async () => {
      const text = inputText.trim();
      if (!text || isTyping) return;
      setInputText('');
      Keyboard.dismiss();

      const userMsg = { role: 'user', text, id: `u_${Date.now()}` };
      setMessages(prev => [...prev, userMsg]);
      setIsTyping(true);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

      try {
        // 1. Build Gemini history from existing messages
        //    Inject system prompt as first user/model exchange so Gemini follows it
        //    Translate role: 'assistant' → 'model' as Gemini requires
        const history = [
          { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
          { role: 'model', parts: [{ text: 'Understood. I am MotoLink AI and will follow those instructions.' }] },
          ...messages
            .filter(m => m.id !== 'greeting')
            .map(msg => ({
              role: msg.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: msg.text }],
            })),
          { role: 'user', parts: [{ text }] },
        ];

        // 2. Gemini API call — gemini-2.5-flash primary, fallbacks on 429
        const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY
          || process.env.EXPO_PUBLIC_GEMINI_KEY
          || 'AIzaSyAfPhXRmJr26ydMPZGWWmNG7TsKPpLDmUY';

        const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
        let response = null, result = null;

        for (const model of models) {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: history,
                generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
              }),
            }
          );
          result = await response.json();
          if (response.status !== 429) break;
          await new Promise(r => setTimeout(r, 900));
        }

        // 3. Extract reply — Gemini path: candidates[0].content.parts[0].text
        if (response.ok && !result?.error) {
          let aiReply = result?.candidates?.[0]?.content?.parts?.[0]?.text
            || (lang === 'rw' ? 'Mbabarira, hari ikibazo.' : lang === 'fr' ? 'Désolé.' : "Sorry, I couldn't generate a response.");

          // 4. Parse any in-app ACTION the AI wants to trigger
          //    Format: ACTION:{"type":"...","destination":"..."} on its own line
          const actionMatch = aiReply.match(/ACTION:(\{[^}]+\})/);
          if (actionMatch) {
            try {
              const action = JSON.parse(actionMatch[1]);
              // Strip the ACTION line from the displayed message
              aiReply = aiReply.replace(/ACTION:\{[^}]+\}\n?/, '').trim();
              // Slight delay so user reads the message first
              setTimeout(() => onAction && onAction(action), 800);
            } catch {}
          }

          setIsTyping(false);
          // 5. Update UI state with the reply (action line removed)
          setMessages(prev => [...prev, { role: 'assistant', text: aiReply, id: Date.now().toString() }]);
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
          return;
        }

        // API returned an error status
        const status = response.status;
        const errReply = status === 429
          ? (lang === 'rw' ? 'Ubufasha bwa AI burapfuye. Gerageza nyuma y\'akanya gato.' :
             lang === 'fr' ? "L'assistant IA est surchargé. Réessayez dans un moment." :
             'MotoLink AI is briefly busy. Please try again in a moment. 🏍️')
          : status === 400
          ? (lang === 'rw' ? 'Ikibazo ntikisobanuka. Ongera ugerageze mu magambo atandukanye.' :
             lang === 'fr' ? "Je n'ai pas compris. Reformulez s'il vous plaît." :
             "I didn't quite understand that. Could you rephrase?")
          : (lang === 'rw' ? 'Nta murandasi mwiza. Gerageza nyuma y\'akanya gato. 🏍️' :
             lang === 'fr' ? 'Connexion insuffisante. Réessayez dans un moment. 🏍️' :
             'AI is taking a moment. Check your internet and try again. 🏍️');
        setIsTyping(false);
        setMessages(prev => [...prev, { role: 'assistant', text: errReply, id: Date.now().toString() }]);

      } catch (error) {
        console.error('Gemini Error:', error);
        setIsTyping(false);
        const netErr = lang === 'rw' ? 'Nta murandasi. Ongera ugerageze.' :
          lang === 'fr' ? 'Pas de connexion. Réessayez.' :
          'Network error. Please check your connection and try again.';
        setMessages(prev => [...prev, { role: 'assistant', text: netErr, id: `err_${Date.now()}` }]);
      }
    };

    const quickReplies = role === 'driver' ? {
      en: ['How do I maximise earnings?',
        'What is surge pricing?',
        'How does MoMo/Airtel payout work?',
        'How do scheduled trips work?'],
      rw: ['Nzongera inyungu zanjye nte?',
        'Surge pricing ni iki?',
        'Kwishyurwa kwa MoMo/Airtel ni bute?',
        'Inzira zateganyirijwe ni zihe?'],
      fr: ['Comment maximiser mes gains?',
        'C\'est quoi le surge pricing?',
        'Comment fonctionne MoMo/Airtel?',
        'Comment gérer les trajets planifiés?'],
    }: {
      en: ['How do I book a ride?',
        'What are the fares?',
        'How does MoMo/Airtel payment work?',
        'Can I schedule a ride?'],
      rw: ['Nifata inzira nte?',
        'Ibiciro ni bingahe?',
        'Ubwishyu bwa MoMo/Airtel ni bute?',
        'Nshobora guteganya urugendo?'],
      fr: ['Comment réserver un trajet?',
        'Quels sont les tarifs?',
        'Comment fonctionne MoMo/Airtel?',
        'Puis-je planifier un trajet?'],
    };
    const qr = quickReplies[lang] || quickReplies.en;

    return (
      <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
        <Animated.View style={ { flex: 1, backgroundColor: `rgba(0,0,0,0.72)`, opacity: fadeAnim }}>
          <TouchableOpacity style={ { flex: 1 }} activeOpacity={1} onPress={onClose} />
          <Animated.View style={ {
            transform: [{ translateY: slideAnim }],
            height: height * 0.82,
            backgroundColor: C.charcoal,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderWidth: 1,
            borderColor: C.border,
            overflow: 'hidden',
          }}>
            {/* Gold accent line */}
            <View style={ { height: 3, backgroundColor: C.gold, width: '100%' }} />
            {/* Header */}
            <View style={ { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.borderFaint }}>
              <View style={ { width: 40, height: 40, borderRadius: 20, backgroundColor: C.goldDim, borderWidth: 1.5, borderColor: C.gold, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                <Text style={ { fontSize: 18 }}>🏍️</Text>
              </View>
              <View style={ { flex: 1 }}>
                <Text style={ { color: C.gold, fontWeight: '900', fontSize: 15, letterSpacing: 1.5 }}>MOTOLINK AI</Text>
                <View style={ { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <View style={ { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green }} />
                  <Text style={ { color: C.gray, fontSize: 11 }}>
                    {lang === 'rw' ? 'Mufasha wawe': lang === 'fr' ? 'Votre assistant': 'Your assistant'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={onClose} style={ { width: 34, height: 34, borderRadius: 17, backgroundColor: C.glassLight, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={ { color: C.gray, fontSize: 18, fontWeight: '600' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Messages */}
            <ScrollView
              ref={scrollRef}
              style={ { flex: 1, paddingHorizontal: 16 }}
              contentContainerStyle={ { paddingTop: 16, paddingBottom: 10 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
              >
              {messages.map((msg, i) => <MessageBubble key={msg.id} msg={msg} index={i} />)}
              {isTyping && (
                <View style={ { flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <View style={ { width: 22, height: 22, borderRadius: 11, backgroundColor: C.goldDim, borderWidth: 1, borderColor: C.gold, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                    <Text style={ { fontSize: 12 }}>🏍️</Text>
                  </View>
                  <View style={ { backgroundColor: C.card2, borderRadius: 18, borderTopLeftRadius: 4, padding: 13, borderWidth: 1, borderColor: C.borderFaint }}>
                    <View style={ { flexDirection: 'row', gap: 5, alignItems: 'center' }}>
                      {[0, 1, 2].map(i => (
                        <Animated.View key={i} style={ {
                          width: 7, height: 7, borderRadius: 4, backgroundColor: C.gold,
                          opacity: dotAnim.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: i === 0 ? [0.3, 1, 0.3, 0.3]: i === 1 ? [0.3, 0.3, 1, 0.3]: [0.3, 0.3, 0.3, 1] }),
                          transform: [{ scale: dotAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.1] }) }],
                        }} />
                      ))}
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Quick replies */}
            {messages.length <= 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ { paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.borderFaint }} contentContainerStyle={ { gap: 8 }}>
                {qr.map((q, i) => (
                  <TouchableOpacity key={i} onPress={() => { setInputText(q); setTimeout(() => inputRef.current?.focus(), 100); }}
                    style={ { backgroundColor: C.goldDim, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.border }}>
                    <Text style={ { color: C.gold, fontSize: 12, fontWeight: '700' }}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* Input */}
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding': undefined}>
              <View style={ { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.borderFaint, gap: 10, backgroundColor: C.charcoal }}>
                <TextInput
                  ref={inputRef}
                  style={ { flex: 1, backgroundColor: C.card2, color: C.white, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22, fontSize: 14, borderWidth: 1, borderColor: C.borderFaint, maxHeight: 90 }}
                  placeholder={lang === 'rw' ? 'Andika ikibazo cyawe...': lang === 'fr' ? 'Écrivez votre question...': 'Ask me anything...'}
                  placeholderTextColor={C.grayDark}
                  value={inputText}
                  onChangeText={setInputText}
                  multiline
                  returnKeyType="send"
                  onSubmitEditing={sendMessage}
                  blurOnSubmit={false}
                  />
                <TouchableOpacity onPress={sendMessage} disabled={!inputText.trim() || isTyping}
                  style={ { width: 46, height: 46, borderRadius: 23, backgroundColor: inputText.trim() && !isTyping ? C.gold: C.card2, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: inputText.trim() && !isTyping ? C.gold: C.borderFaint }}>
                  <Text style={ { fontSize: 20 }}>{isTyping ? '⏳': '🚀'}</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </Animated.View>
        </Animated.View>
      </Modal>
    );
  };

  // ══════════════════════════════════════════════
  // ROOT
  // ══════════════════════════════════════════════
  export default function App() {
    const [state,
      dispatch] = useReducer(reducer, initialState);
    return (
      <SafeAreaProvider>
        <ErrorBoundary fallbackRender={({ error })=>(
          <View style={styles.authView}>
            <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
            <Text style={ { color: C.red, textAlign: 'center', marginTop: 16 }}>⚠️ {error.message}</Text>
          </View>
        )}>
          <AppContext.Provider value={ { state, dispatch }}>
            <MotoLink />
          </AppContext.Provider>
        </ErrorBoundary>
      </SafeAreaProvider>
    );
  }

  // ══════════════════════════════════════════════
  // STYLES
  // ══════════════════════════════════════════════
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: C.black,
      width: '100%',
      maxWidth: '100%',
      overflow: 'hidden',
      ...(Platform.OS === 'web' ? {
        height: '100vh', position: 'relative'
      }: {}),
    },
    map: {
      flex: 1,
      backgroundColor: C.black,
      width: '100%',
      ...(Platform.OS === 'web' ? {
        minHeight: 300
      }: {}),
    },
    authView: {
      flexGrow: 1,
      backgroundColor: C.black,
      justifyContent: 'center',
      padding: 28,
      paddingTop: 60
    },
    splashContainer: {
      flex: 1,
      backgroundColor: C.black,
      justifyContent: 'center',
      alignItems: 'center'
    },
    splashLogoRing: {
      width: 76,
      height: 76,
      borderRadius: 38,
      borderWidth: 2.5,
      borderColor: C.gold,
      backgroundColor: C.goldDim,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 14,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.75,
      shadowRadius: 28,
      elevation: 20,
    },
    splashLogoTxt: {
      color: C.goldBright,
      fontWeight: '900',
      fontSize: 24,
      letterSpacing: 2,
      textShadowColor: C.gold,
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: 12,
    },
    splashLogoRingSmall: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: C.gold,
      backgroundColor: C.goldDim,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.45,
      shadowRadius: 10,
      elevation: 6,
    },
    splashLogoTxtSmall: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 11,
      letterSpacing: 1
    },
    splashTitle: {
      color: C.gold,
      fontSize: 30,
      fontWeight: '900',
      letterSpacing: 5,
      textAlign: 'center',
      marginBottom: 6
    },
    splashSlogan: {
      color: C.gray,
      fontSize: 13,
      letterSpacing: 2,
      fontStyle: 'italic'
    },
    roleRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 28
    },
    roleBtn: {
      flex: 1,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      alignItems: 'center',
      backgroundColor: C.glass,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 4,
    },
    activeRole: {
      borderColor: C.gold,
      backgroundColor: C.goldDim,
      shadowColor: C.gold,
      shadowOpacity: 0.25,
      shadowRadius: 14,
      elevation: 8,
    },
    roleTxt: {
      color: C.gray,
      fontWeight: '700',
      fontSize: 13,
      letterSpacing: 0.5
    },
    inputWrap: {
      marginBottom: 14
    },
    inputLabel: {
      color: C.gray,
      fontSize: 11,
      letterSpacing: 1.2,
      marginBottom: 6,
      marginLeft: 2,
      textTransform: 'uppercase'
    },
    input: {
      backgroundColor: C.glassInput,
      color: C.white,
      padding: 16,
      borderRadius: 16,
      fontSize: 15,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 3,
    },
    passRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    eyeBtn: {
      width: 52,
      height: 52,
      backgroundColor: C.glassInput,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: C.borderFaint
    },
    eyeIcon: {
      fontSize: 20
    },
    mainBtn: {
      backgroundColor: C.gold,
      paddingVertical: 18,
      paddingHorizontal: 20,
      borderRadius: 20,
      alignItems: 'center',
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.65,
      shadowRadius: 22,
      elevation: 16,
      borderWidth: 1,
      borderColor: C.goldBright,
    },
    mainBtnTxt: {
      color: C.black,
      fontWeight: '900',
      fontSize: 15,
      letterSpacing: 2,
    },
    outlineBtn: {
      paddingVertical: 15,
      paddingHorizontal: 16,
      borderRadius: 18,
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: C.border,
      backgroundColor: C.glass,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.10,
      shadowRadius: 10,
      elevation: 3,
    },
    outlineBtnTxt: {
      color: C.gold,
      fontWeight: '700',
      fontSize: 14,
    },
    langBtn: {
      backgroundColor: C.glass,
      padding: 18,
      borderRadius: 18,
      marginVertical: 7,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    langTxt: {
      color: C.white,
      textAlign: 'center',
      fontWeight: '700',
      fontSize: 15,
      letterSpacing: 0.5
    },
    header: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 200,
      paddingHorizontal: 12,
      paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 4: 4,
      paddingBottom: 6,
    },
    searchRow: {
      width: '100%',
      marginBottom: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
      flexWrap: 'nowrap',
    },
    hamburgerWrap: {
      width: 42,
      height: 42,
      backgroundColor: C.glass,
      borderRadius: 21,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: C.border,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 10,
      elevation: 6,
    },
    bar: {
      width: 20,
      height: 2,
      backgroundColor: C.gold,
      marginVertical: 2.5,
      borderRadius: 2,
    },
    driverHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    driverDashTxt: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 15,
      letterSpacing: 2.5,
    },
    avatarWrap: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: C.card2,
      borderWidth: 2,
      borderColor: C.goldBright,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.55,
      shadowRadius: 12,
      elevation: 8,
    },
    avatarTxt: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 13,
      letterSpacing: 0.5,
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    // ── Search bar — glass (dark), not the old white pill ─────────────────
    searchContainer: {
      flexDirection: 'row',
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderRadius: 28,
      height: 52,
      alignItems: 'center',
      elevation: 14,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 14,
      width: '100%',
      borderWidth: 1.5,
      borderColor: C.border,
    },
    searchInput: {
      flex: 1,
      paddingHorizontal: 18,
      color: C.white,
      fontWeight: '500',
      fontSize: 14,
      minWidth: 0,
    },
    searchIconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: C.gold,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 5,
      flexShrink: 0,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.5,
      shadowRadius: 8,
      elevation: 6,
    },
    suggestionOverlay: {
      position: 'absolute',
      top: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 118: 138,
      left: 12,
      right: 12,
      zIndex: 9000,
      elevation: 35,
    },
    suggestionBox: {
      backgroundColor: 'rgba(16,16,30,0.97)',
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: C.border,
      maxHeight: 300,
      overflow: 'hidden',
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.22,
      shadowRadius: 24,
      elevation: 30,
    },
    suggestionItem: {
      paddingVertical: 13,
      paddingHorizontal: 16,
      borderBottomColor: C.borderFaint,
      borderBottomWidth: 1,
    },
    suggestionTitle: {
      color: C.white,
      fontSize: 13,
      fontWeight: '700',
    },
    suggestionSub: {
      color: C.gray,
      fontSize: 11,
      marginTop: 3,
    },
    notifyBanner: {
      position: 'absolute',
      top: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10: 54,
      left: 10,
      right: 10,
      zIndex: 9999,
      backgroundColor: 'rgba(16,16,30,0.96)',
      borderRadius: 22,
      flexDirection: 'row',
      alignItems: 'center',
      overflow: 'hidden',
      borderWidth: 1.5,
      borderColor: C.border,
      elevation: 40,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.30,
      shadowRadius: 28,
      paddingRight: 10,
      minHeight: 72,
    },
    notifyAccent: {
      width: 4,
      alignSelf: 'stretch',
    },
    notifyLogoWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: 10,
      marginVertical: 12,
    },
    notifyLogoTxt: {
      fontWeight: '900',
      fontSize: 11,
      letterSpacing: 1,
    },
    notifyContent: {
      flex: 1,
      paddingLeft: 10,
      paddingVertical: 10,
    },
    notifyTitle: {
      color: C.white,
      fontWeight: '900',
      fontSize: 13,
      letterSpacing: 0.4,
    },
    notifyBody: {
      color: C.gray,
      fontSize: 11,
      marginTop: 3,
      lineHeight: 15,
    },
    notifyIcon: {
      fontSize: 22,
      marginLeft: 4,
    },
    notifyProgressTrack: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 2.5,
      backgroundColor: 'rgba(255,255,255,0.06)',
    },
    notifyProgressBar: {
      height: 2.5,
      borderRadius: 2,
    },
    notifyDragHandle: {
      position: 'absolute',
      top: 5,
      left: '50%',
      marginLeft: -16,
      width: 32,
      height: 3,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    // ── Modals ────────────────────────────────────────────────────────────────
    modalBg: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.85)',
      justifyContent: 'center',
      padding: 20,
    },
    glassModal: {
      backgroundColor: C.glass,
      padding: 22,
      borderRadius: 28,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.20,
      shadowRadius: 30,
      elevation: 20,
      overflow: 'hidden',
    },
    rateTitle: {
      color: C.gold,
      fontSize: 22,
      fontWeight: '900',
      letterSpacing: 2,
      marginTop: 12
    },
    rateSub: {
      color: C.gray,
      fontSize: 14,
      marginTop: 4,
      marginBottom: 4
    },
    rateTripSummary: {
      backgroundColor: C.glassMid,
      padding: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.borderFaint,
      width: '100%',
      marginBottom: 16
    },
    rateSummaryTxt: {
      color: C.gray,
      fontSize: 12
    },
    starsRow: {
      flexDirection: 'row',
      gap: 6,
      marginVertical: 14
    },
    rateStar: {
      fontSize: 38
    },
    rateLabel: {
      color: C.gray,
      fontSize: 14,
      marginBottom: 14,
      letterSpacing: 0.5
    },
    reviewInput: {
      backgroundColor: C.glassInput,
      color: C.white,
      padding: 12,
      borderRadius: 14,
      fontSize: 13,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      width: '100%',
      minHeight: 72,
      textAlignVertical: 'top',
      marginBottom: 16
    },
    ratingBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.goldDim,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.border
    },
    ratingBadgeTxt: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 11
    },
    // ── Status panel (overlays the map) ───────────────────────────────────────
    statusPanel: {
      position: 'absolute',
      top: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 88: 108,
      left: 14,
      right: 14,
      backgroundColor: 'rgba(10,10,22,0.90)',
      borderRadius: 24,
      padding: 14,
      zIndex: 220,
      borderWidth: 1.5,
      borderColor: C.border,
      elevation: 25,
      maxHeight: height * 0.38,
      overflow: 'hidden',
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.20,
      shadowRadius: 20,
    },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14
    },
    panelTitle: {
      color: C.gold,
      fontSize: 16,
      fontWeight: '900',
      letterSpacing: 1,
      flex: 1
    },
    routeBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    routeDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: C.gold,
      flexShrink: 0
    },
    routeLine_: {
      width: 1,
      height: 12,
      backgroundColor: C.border,
      marginLeft: 3.5,
      marginVertical: 2
    },
    // ── Trip & job cards ──────────────────────────────────────────────────────
    tripCard: {
      backgroundColor: C.glass,
      padding: 14,
      borderRadius: 18,
      marginBottom: 10,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      width: '100%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 10,
      elevation: 4,
    },
    tripDest: {
      color: C.white,
      fontWeight: '700',
      fontSize: 13,
      flex: 1
    },
    timestampRow: {
      flexDirection: 'column',
      gap: 2,
      marginTop: 6,
      marginBottom: 4
    },
    timestampTxt: {
      color: C.grayDark,
      fontSize: 11
    },
    statusPill: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      marginTop: 8
    },
    statusPillTxt: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 0.5
    },
    driverInfoBox: {
      marginTop: 8,
      padding: 12,
      backgroundColor: C.goldNeon,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: C.border
    },
    driverInfoName: {
      color: C.white,
      fontWeight: '700',
      fontSize: 13
    },
    driverInfoDist: {
      color: C.gray,
      fontSize: 11,
      marginTop: 3
    },
    callBtn: {
      color: C.gold,
      fontWeight: '700',
      marginTop: 6,
      fontSize: 13
    },
    cancelBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: C.redDim,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: 8,
      marginTop: 2
    },
    cancelBtnTxt: {
      color: C.red,
      fontWeight: '900',
      fontSize: 13
    },
    emptyText: {
      color: C.grayDark,
      textAlign: 'center',
      padding: 20,
      fontStyle: 'italic'
    },
    // ── Bottom sheet — premium glass ─────────────────────────────────────────
    bottomSheet: {
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      width: '100%',
      backgroundColor: 'rgba(10,10,22,0.97)',
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: Platform.OS === 'ios' ? 34 : 16,
      borderTopLeftRadius: 36,
      borderTopRightRadius: 36,
      elevation: 34,
      zIndex: 50,
      borderTopWidth: 1.5,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: C.border,
      maxHeight: height * 0.65,
      overflow: 'visible',
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.22,
      shadowRadius: 28,
    },
    fareRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 10,
      marginBottom: 12
    },
    fareAmt: {
      color: C.gold,
      fontSize: 28,
      fontWeight: '900',
      letterSpacing: 0.5,
    },
    fareDist: {
      color: C.gray,
      fontSize: 13
    },
    payToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
      gap: 6,
      flexWrap: 'wrap'
    },
    payToggleBtn: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 22,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      backgroundColor: C.glass,
    },
    payToggleBtnActive: {
      borderColor: C.gold,
      backgroundColor: C.goldDim,
      shadowColor: C.gold,
      shadowOpacity: 0.25,
      shadowRadius: 10,
      elevation: 4,
    },
    payToggleTxt: {
      color: C.gray,
      fontWeight: '700',
      fontSize: 12
    },
    hintText: {
      color: C.grayDark,
      textAlign: 'center',
      fontSize: 14,
      fontStyle: 'italic'
    },
    jobTitle: {
      color: C.gold,
      fontSize: 15,
      fontWeight: '900',
      letterSpacing: 0.5,
      marginBottom: 6
    },
    jobCard: {
      backgroundColor: C.glass,
      padding: 16,
      borderRadius: 22,
      marginBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: C.border,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
      elevation: 8,
    },
    jobPrice: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 20,
      letterSpacing: 0.3,
    },
    acceptBtn: {
      backgroundColor: C.gold,
      paddingVertical: 13,
      paddingHorizontal: 18,
      borderRadius: 16,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.60,
      shadowRadius: 14,
      elevation: 10,
    },
    acceptBtnTxt: {
      color: C.black,
      fontWeight: '900',
      fontSize: 11,
      letterSpacing: 0.8,
    },
    driverContactRow: {
      backgroundColor: C.glass,
      padding: 14,
      borderRadius: 18,
      marginVertical: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    },
    callPill: {
      backgroundColor: C.goldDim,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 22,
      borderWidth: 1.5,
      borderColor: C.border,
    },
    callPillTxt: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 12,
      letterSpacing: 0.3,
    },
    // ── Payment modal ─────────────────────────────────────────────────────────
    payModal: {
      backgroundColor: 'rgba(10,10,22,0.97)',
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      padding: 24,
      borderWidth: 1.5,
      borderColor: C.border,
      maxHeight: height*0.88,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.20,
      shadowRadius: 28,
      elevation: 30,
    },
    payModalTitle: {
      color: C.gold,
      fontSize: 20,
      fontWeight: '900',
      letterSpacing: 1,
      marginTop: 10
    },
    driverPayInfo: {
      backgroundColor: C.goldNeon,
      padding: 14,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: C.border,
      marginBottom: 16
    },
    driverPayLabel: {
      color: C.gray,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: 'uppercase'
    },
    payOptionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.glass,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      gap: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    },
    payOptionTitle: {
      color: C.white,
      fontWeight: '800',
      fontSize: 15
    },
    payOptionSub: {
      color: C.gray,
      fontSize: 12,
      marginTop: 2
    },
    payOptionBadge: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
      borderWidth: 1.5,
    },
    ussdInfoBox: {
      backgroundColor: C.glass,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: C.border,
      marginBottom: 12,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 14,
      elevation: 6,
    },
    methodBtn: {
      flex: 1,
      padding: 14,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      backgroundColor: C.glass,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    methodTxt: {
      color: C.gray,
      fontWeight: '700',
      fontSize: 13
    },
    // ── SOS ──────────────────────────────────────────────────────────────────
    sosBtn: {
      position: 'absolute',
      zIndex: 8888,
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor: C.red,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 30,
      shadowColor: C.red,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.85,
      shadowRadius: 20,
    },
    sosPulse: {
      position: 'absolute',
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor: 'rgba(255,69,96,0.30)',
    },
    sosBtnTxt: {
      color: C.white,
      fontWeight: '900',
      fontSize: 13,
      letterSpacing: 1,
    },
    sosContactBox: {
      backgroundColor: 'rgba(255,76,76,0.08)',
      padding: 14,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: 'rgba(255,76,76,0.25)',
      marginBottom: 14,
    },
    sosContactLabel: {
      color: C.red,
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    // ── Header icon buttons ───────────────────────────────────────────────────
    historyBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: C.glass,
      borderWidth: 1.5,
      borderColor: C.border,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 5,
    },
    // ── Trip history screen ──────────────────────────────────────────────────
    historyScreen: {
      flex: 1,
      backgroundColor: C.black,
    },
    historyHeader: {
      backgroundColor: 'rgba(10,10,22,0.96)',
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderBottomWidth: 1.5,
      borderColor: C.border,
    },
    historyTitle: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 18,
      letterSpacing: 2,
      flex: 1,
      marginLeft: 10,
    },
    historySummary: {
      flexDirection: 'row',
      backgroundColor: C.goldDim,
      margin: 16,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1.5,
      borderColor: C.border,
      alignItems: 'center',
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
      elevation: 8,
    },
    summaryValue: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 22,
      textAlign: 'center',
    },
    summaryLabel: {
      color: C.gray,
      fontSize: 11,
      textAlign: 'center',
      marginTop: 4,
      letterSpacing: 0.5,
    },
    summarySep: {
      width: 1,
      height: 40,
      backgroundColor: C.border,
      marginHorizontal: 16,
    },
    historyCard: {
      backgroundColor: C.glass,
      marginHorizontal: 16,
      marginBottom: 10,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 10,
      elevation: 5,
    },
    receiptExpanded: {
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: 1,
      borderColor: C.borderFaint,
    },
    receiptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 7,
      borderBottomWidth: 1,
      borderColor: C.borderFaint,
    },
    receiptLabel: {
      color: C.gray,
      fontSize: 12,
      flex: 1,
    },
    receiptValue: {
      color: C.white,
      fontSize: 12,
      fontWeight: '600',
      textAlign: 'right',
      flex: 1,
    },
    receiptShareBtn: {
      flex: 1,
      padding: 12,
      borderRadius: 14,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    receiptShareTxt: {
      fontWeight: '800',
      fontSize: 12,
      letterSpacing: 0.5,
    },
    loadMoreBtn: {
      marginHorizontal: 16,
      marginBottom: 10,
      padding: 16,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: C.border,
      alignItems: 'center',
      backgroundColor: C.goldDim,
    },
    loadMoreTxt: {
      color: C.gold,
      fontWeight: '800',
      fontSize: 14,
      letterSpacing: 0.5,
    },
    // ── Earnings dashboard ────────────────────────────────────────────────────
    earningsBox: {
      backgroundColor: C.glass,
      borderRadius: 18,
      padding: 16,
      marginTop: 16,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 10,
      elevation: 5,
    },
    earningsHeader: {
      marginBottom: 12,
    },
    earningsSectionTitle: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 15,
      letterSpacing: 0.5,
    },
    earningsTabs: {
      flexDirection: 'row',
      marginBottom: 14,
    },
    earningsTab: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      backgroundColor: C.glass,
      marginRight: 8,
    },
    earningsTabActive: {
      borderColor: C.gold,
      backgroundColor: C.goldDim,
      shadowColor: C.gold,
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    },
    earningsTabTxt: {
      color: C.gray,
      fontWeight: '700',
      fontSize: 12,
    },
    earningsStatsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.35)',
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: C.borderFaint,
    },
    earningsStat: {
      flex: 1,
      alignItems: 'center',
    },
    earningsStatVal: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 15,
      textAlign: 'center',
    },
    earningsStatLbl: {
      color: C.gray,
      fontSize: 10,
      marginTop: 4,
      textAlign: 'center',
    },
    earningsStatSep: {
      width: 1,
      height: 36,
      backgroundColor: C.border,
    },
    earningsPeakRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: C.goldDim,
      borderRadius: 14,
      padding: 12,
      borderWidth: 1.5,
      borderColor: C.border,
      marginBottom: 10,
    },
    earningsPeakLabel: {
      color: C.gold,
      fontWeight: '700',
      fontSize: 12,
    },
    earningsPeakVal: {
      color: C.white,
      fontWeight: '800',
      fontSize: 12,
    },
    earningsRecentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderColor: C.borderFaint,
    },
    // ── Surge pricing ─────────────────────────────────────────────────────────
    surgeBanner: {
      backgroundColor: 'rgba(243,156,18,0.12)',
      borderWidth: 1.5,
      borderColor: 'rgba(243,156,18,0.40)',
      borderRadius: 14,
      padding: 10,
      marginTop: 10,
      marginBottom: 2,
    },
    surgeBannerTxt: {
      color: C.orange,
      fontWeight: '900',
      fontSize: 13,
      letterSpacing: 0.5,
    },
    surgeBannerSub: {
      color: C.orange,
      fontSize: 11,
      marginTop: 3,
      opacity: 0.8,
    },
    surgePill: {
      backgroundColor: 'rgba(243,156,18,0.18)',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: 'rgba(243,156,18,0.50)',
      marginTop: 4,
    },
    surgePillTxt: {
      color: C.orange,
      fontWeight: '900',
      fontSize: 11,
    },
    // ── Close button ──────────────────────────────────────────────────────────
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: C.glass,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: C.borderFaint,
    },
    // ── Promo code ────────────────────────────────────────────────────────────
    promoRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 10,
    },
    promoInput: {
      flex: 1,
      backgroundColor: C.glassInput,
      color: C.white,
      padding: 12,
      borderRadius: 14,
      fontSize: 13,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      letterSpacing: 2,
    },
    promoApplyBtn: {
      backgroundColor: C.gold,
      paddingHorizontal: 16,
      borderRadius: 14,
      justifyContent: 'center',
      alignItems: 'center',
      minWidth: 72,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.45,
      shadowRadius: 10,
      elevation: 6,
    },
    promoApplyTxt: {
      color: C.black,
      fontWeight: '900',
      fontSize: 12,
    },
    promoAppliedBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: C.greenDim,
      borderRadius: 14,
      padding: 12,
      borderWidth: 1.5,
      borderColor: C.green+'44',
      marginBottom: 10,
    },
    promoAppliedTxt: {
      color: C.green,
      fontWeight: '900',
      fontSize: 13,
      letterSpacing: 1,
    },
    finalPriceRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 12,
      marginBottom: 12,
    },
    // ── Referral ──────────────────────────────────────────────────────────────
    referralBox: {
      backgroundColor: C.goldDim,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1.5,
      borderColor: C.border,
      marginBottom: 14,
      marginTop: 6,
      shadowColor: C.gold,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 6,
    },
    referralLabel: {
      color: C.gold,
      fontWeight: '900',
      fontSize: 12,
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    referralCodeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    referralCodeTxt: {
      color: C.white,
      fontWeight: '900',
      fontSize: 20,
      letterSpacing: 4,
      flex: 1,
    },
    referralShareBtn: {
      backgroundColor: C.green+'22',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: C.green+'44',
    },
    referralShareTxt: {
      color: C.green,
      fontWeight: '800',
      fontSize: 12,
    },
    referralEarnedRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderColor: C.border,
    },
    // ── History tabs ──────────────────────────────────────────────────────────
    histTabRow: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginBottom: 4,
      backgroundColor: C.glass,
      borderRadius: 16,
      padding: 4,
      borderWidth: 1,
      borderColor: C.borderFaint,
    },
    histTab: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderRadius: 12,
    },
    histTabActive: {
      backgroundColor: C.goldDim,
      borderWidth: 1,
      borderColor: C.border,
    },
    histTabTxt: {
      color: C.gray,
      fontWeight: '700',
      fontSize: 12,
    },
    histActionBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    histActionTxt: {
      fontWeight: '900',
      fontSize: 12,
      letterSpacing: 0.5,
    },
    // ── Offline banner ────────────────────────────────────────────────────────
    offlineBanner: {
      position: 'absolute',
      top: Platform.OS === 'android' ? (StatusBar.currentHeight || 0): 0,
      left: 0,
      right: 0,
      zIndex: 1500,
      backgroundColor: 'rgba(8,8,40,0.97)',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderBottomWidth: 1.5,
      borderColor: C.blue,
    },
    offlineBannerTxt: {
      color: C.blue,
      fontWeight: '700',
      fontSize: 12,
      textAlign: 'center',
    },
    offlineBannerSub: {
      color: C.gray,
      fontSize: 10,
      textAlign: 'center',
      marginTop: 2,
    },
    // ── Service mode toggle ───────────────────────────────────────────────────
    serviceModeRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    serviceModeBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      backgroundColor: C.glass,
      alignItems: 'center',
    },
    serviceModeBtnActive: {
      borderColor: C.gold,
      backgroundColor: C.goldDim,
    },
    serviceModeTxt: {
      color: C.gray,
      fontWeight: '700',
      fontSize: 13,
    },
    // ── Delivery fields ───────────────────────────────────────────────────────
    deliveryFieldsBox: {
      backgroundColor: C.glass,
      borderRadius: 16,
      padding: 12,
      borderWidth: 1.5,
      borderColor: C.blueDim,
      marginBottom: 10,
    },
    // ── Multi-stop ────────────────────────────────────────────────────────────
    addStopBtn: {
      borderWidth: 1.5,
      borderColor: C.blue,
      borderRadius: 14,
      paddingVertical: 8,
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 4,
      backgroundColor: C.blueDim,
    },
    addStopTxt: {
      color: C.blue,
      fontWeight: '800',
      fontSize: 13,
    },
    // ── Schedule mode ─────────────────────────────────────────────────────────
    scheduleModeRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 10,
      marginBottom: 4,
    },
    scheduleBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      backgroundColor: C.glass,
      alignItems: 'center',
    },
    scheduleBtnActive: {
      borderColor: C.gold,
      backgroundColor: C.goldDim,
    },
    scheduleBtnTxt: {
      color: C.gray,
      fontWeight: '700',
      fontSize: 12,
    },
    // ── Time slot chips ───────────────────────────────────────────────────────
    datePickerBox: {
      backgroundColor: C.glass,
      borderRadius: 16,
      padding: 12,
      borderWidth: 1.5,
      borderColor: C.border,
      marginBottom: 10,
    },
    timeSlot: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      backgroundColor: C.glass,
      marginRight: 8,
      alignItems: 'center',
      minWidth: 72,
    },
    timeSlotActive: {
      borderColor: C.gold,
      backgroundColor: C.goldDim,
      shadowColor: C.gold,
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    },
    timeSlotDay: {
      color: C.gray,
      fontSize: 10,
      fontWeight: '600',
    },
    timeSlotTime: {
      color: C.white,
      fontSize: 13,
      fontWeight: '800',
      marginTop: 2,
    },
    // ── Leaderboard ───────────────────────────────────────────────────────────
    leaderboardBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: C.goldDim,
      borderWidth: 1.5,
      borderColor: C.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    leaderboardBtnTxt: {
      fontSize: 18,
    },
    leaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      backgroundColor: C.glass,
      borderRadius: 16,
      marginBottom: 8,
      borderWidth: 1.5,
      borderColor: C.borderFaint,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 3,
    },
    leaderRank: {
      fontSize: 20,
      width: 32,
      textAlign: 'center',
    },
  });