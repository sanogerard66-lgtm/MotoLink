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
  useState
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
  KeyboardAvoidingView
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView
} from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

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
// 2. DESIGN TOKENS
// ══════════════════════════════════════════════
const C = {
  black: '#0A0A0A',
  charcoal: '#121212',
  card: '#1A1A1A',
  card2: '#222222',
  gold: '#D4AF37',
  goldDim: 'rgba(212,175,55,0.15)',
  goldBright: '#F0D060',
  white: '#FFFFFF',
  offWhite: '#E8E8E8',
  glass: 'rgba(18,18,18,0.93)',
  glassLight: 'rgba(255,255,255,0.06)',
  border: 'rgba(212,175,55,0.25)',
  borderFaint: 'rgba(255,255,255,0.08)',
  red: '#FF4C4C',
  redDim: 'rgba(255,76,76,0.15)',
  green: '#2ECC71',
  greenDim: 'rgba(46,204,113,0.15)',
  blue: '#3498DB',
  blueDim: 'rgba(52,152,219,0.15)',
  orange: '#F39C12',
  orangeDim: 'rgba(243,156,18,0.15)',
  gray: '#A0A0A0',
  grayDark: '#555',
  mtn: '#FFCC00',
  airtel: '#FF4444',
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
  },

  rw: {
    welcome: 'Ikaze kuri MotoLink',
    slogan: 'Ikoranabuhanga mu gutwara abantu',
    signIn: 'Injira',
    signUp: 'Iyandikishe',
    phone: 'Nomero yawe',
    pass: 'Ijambo banga',
    confirmPass: 'Emeza ijambo banga',
    name: 'Amazina yombi',
    driver: 'Umushoferi',
    pax: 'Umugenzi',
    newAcc: 'Ntiwiyandikishije? Kora Konti',
    hasAcc: 'Usanzwe ufite konti? Injira',
    passMatch: '✓ Amagambo banga ahuye',
    passMismatch: '✗ Ntahuye',
    driverDash: 'IKIBAHO CY\'UMUSHOFERI',
    myRequests: 'Ibimurikwa byawe',
    noRequests: 'Nta bimurikwa bihari.',
    searchWhere: 'Urajya he? (urugero: Remera, Bus Park)',
    searchHint: 'Shakisha aho ujya hejuru gutangira.',
    scanJobs: 'Gushakisha ibikorwa...',
    availJobs: 'Imirimo Iboneka',
    pending: '⏳ GUTEGEREZA UMUSHOFERI',
    accepted: '✅ BYEMEJWE',
    sentAt: 'Itumwa',
    acceptedAt: 'Byemejwe',
    cancelledAt: 'Byahagaritswe',
    requestedAt: 'Byasabwe',
    from: 'Uvuye',
    to: 'Ujya',
    payWith: 'Ishura ukoresheje',
    cash: '💵 Amafaranga',
    momoTap: '📲 MoMo',
    walletPay: '💳 Portofeuille',
    choosePayment: 'Hitamo Uburyo bwo Kwishura',
    paymentInfo: 'Amakuru y\'Ubwishyu bw\'Umushoferi',
    payMerchant: 'Ishura ukoresheje Code ya Marchande',
    payMomo: 'Ishura ukoresheje Numero ya MoMo',
    tapToPay: 'Kanda wirihire',
    paidBtn: "Narishe ✓",
    confirmReceived: 'Emeza ko wahawe Amafaranga',
    paymentReceived: 'Amafaranga yabonywe ✓',
    paymentSetup: 'Gushyiraho Ubwishyu',
    momoType: 'Ubwoko bw\'Konti',
    personal: 'MoMo Bwite',
    merchant: 'Code ya Marchande',
    momoNumber: 'Numero ya MoMo',
    merchantCode: 'Code ya Marchande',
    accountHolder: 'Izina ry\'Nyir\'Konti',
    savePayment: 'Bika Amakuru y\'Ubwishyu',
    paymentRequired: 'Ongeraho amakuru y\'ubwishyu kugira ngo abagenzi bakurihe.',
    noPaymentWarning: '⚠️ Shyiraho amakuru y\'ubwishyu',
    arrivedBtn: 'Nageze — Saba Gusoza Urugendo',
    completionRequested: 'Umushoferi arageze! Emeza ukomeze.',
    confirmComplete: 'Emeza ko Urugendo Rusojwe',
    driverConfirm: 'Emeza ko Wahawe Amafaranga',
    awaitingPayment: 'Gutegereza ubwishyu bw\'umugenzi...',
    awaitingDriverConfirm: 'Gutegereza kwemeza kw\'umushoferi...',
    settings: 'Umwirondoro',
    save: 'Bika Umwirondoro',
    signOut: 'Sohoka',
    deleteAcc: 'Siba Konti',
    wallet: 'Imari yanjye',
    topUp: 'Shyiramo Amafaranga',
    txHistory: 'Amateka',
    walletHidden: 'Ubwishyu bw\'imbaho buza vuba.',
    rateTrip: 'Shyiraho Amanota',
    skipRating: 'Salaza',
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
    pickupAt: 'Gufata umugenzi',
    cancelTrip: 'HAGARIKA',
    completeTrip: 'SOZA',
    poor: '😞 Nabi cyane',
    fair: '😐 Nabi',
    good: '🙂 Byiza',
    great: '😊 Byiza cyane',
    excellent: '🤩 Birahebeje!',
    tapStar: 'Kanda inyenyeri gusuzuma',
    reviewPlaceholder: 'Siga igitekerezo (ntibisabwa)...',
    // SOS
    sos: 'SOS',
    sosTitle: '🚨 Ubufasha bwa Ngombwa',
    sosConfirm: 'Iki kizatuma uhamagarwa umurongo w\'umutekano wa MotoLink, wohereze aho uri kuri WhatsApp, no kumenyesha uwo mwegereye.',
    sosSend: 'OHEREZA SOS NONAHA',
    sosCancel: 'Hagarika — Ndi Muri Amahoro',
    sosActivated: '🚨 SOS Yoherejwe',
    sosSent: 'Itsinda ry\'umutekano n\'uwo mwegereye bamenyeshejwe. Ubufasha buragenda.',
    emergencyContact: 'Uwo Mwegereye mu Bihe By\'Ingorane',
    emergencyName: 'Izina ry\'Uwo Mwegereye',
    emergencyPhone: 'Telefone y\'Uwo Mwegereye',
    addEmergency: 'Ongeraho Uwo Mwegereye',
    // Trip History
    tripHistory: 'Amateka y\'Inzira',
    noHistory: 'Nta nzira zakorwa.',
    loadMore: 'Shyira ibindi',
    receipt: 'Icyemezo',
    shareWhatsApp: 'Ohereza kuri WhatsApp',
    downloadPDF: 'Manura PDF',
    earnings: 'Inyemezabwishyu',
    totalEarnings: 'Amafaranga Yose Yabonetse',
    totalTrips: 'Inzira Zose',
    tripId: 'Nomero y\'Inzira',
    commission: 'Igice cya Sosiyete (10%)',
    driverEarnings: 'Amafaranga y\'Umushoferi',
    ratingGiven: 'Amanota Yatanzwe',
    notRated: 'Ntiyasuzumwe',
    viewReceipt: 'Reba Icyemezo',
    // Surge
    surgeActive: '⚡ Igiciro Kiriyongereye',
    surgeReason: 'Abakozi bake cyangwa amasaha y\'isoko',
    surge1_5x: 'Igiciro cyiyongereye 1.5×',
    surgeWarning: '⚡ Igiciro kiriyongereye (1.5×). Igiciro ni kinini kuruta igisanzwe kubera abantu benshi.',
    // Earnings dashboard
    earningsDash: 'Ikibaho cy\'Inyemezabwishyu',
    today: 'Uyu Munsi',
    thisWeek: 'Iki Cyumweru',
    thisMonth: 'Uyu Mwaka',
    allTime: 'Ibihe Byose',
    tripsCompleted: 'Inzira Zarangiye',
    avgPerTrip: 'Hagati ku Nzira',
    peakDay: 'Umunsi Mwiza',
    noEarnings: 'Nta nzira zarangiye.',
    // Promo & Referral
    promoCode: 'Kode ya Promo',
    applyCode: 'Shyiraho',
    promoApplied: '🎉 Promo Yashyizweho!',
    promoInvalid: 'Kode ntibaho cyangwa yarangiye.',
    promoUsed: 'Warakoresheje kode iyi.',
    promoSaved: 'barigishijwe kuri urugendo',
    referralCode: 'Kode Yawe yo Kohereza',
    referralShare: 'Sangira & Unguke',
    referralInfo: 'Sangira kode yawe. Unguke 200 FRW buri mushoferi wiyandikisha nazo.',
    referralEarned: 'Amafaranga y\'Abakoherejwe',
    enterRefCode: 'Ufite kode yo kohereza? (si ngombwa)',
    scheduleRide: 'Teganya Urugendo',
    scheduledFor: 'Teganyirijwe',
    scheduleDate: 'Hitamo Itariki na Saa',
    upcomingRides: 'Inzira Ziteganyirijwe',
    scheduleNow: 'Saba Nonaha',
    scheduleLater: 'Teganya Gukurikira',
    inMinutes: 'mu',
    scheduledTrip: '📅 Urugendo Ruteganyirijwe',
    preAccept: 'Emeza Urugendo Uru Mbere',
    addStop: '+ Ongeraho Ahantu',
    removeStop: 'Siba',
    stop: 'Ahantu',
    stops: 'Aho Hatumiwe',
    markReached: 'Emeza ko Wageze ✓',
    nextStop: 'Ahantu Hakurikira',
    allStopsReached: 'Wasize ahose!',
    deliveryMode: 'Kohereza Impahurwa',
    rideMode: 'Urugendo',
    packageDesc: 'Ibisobanuro by\'Impahurwa',
    recipientName: 'Izina ry\'Uwakiriye',
    recipientPhone: 'Telefone y\'Uwakiriye',
    pickedUp: 'Emeza ko Wafashe 📦',
    delivered: 'Emeza ko Wahaye ✓',
    takePhoto: 'Fata Ifoto y\'Ibikenewe',
    deliveryStatus: 'Uko Kohereza Bigenda',
    pending_del: '⏳ Gutegereza Gufatwa',
    pickedUp_del: '📦 Byafashwe',
    delivered_del: '✅ Byahawe',
    business: 'Konti ya Sosiyete',
    joinCompany: 'Injira muri Sosiyete',
    companyCode: 'Kode ya Sosiyete',
    companyName: 'Izina rya Sosiyete',
    rdbNumber: 'Numero ya RDB',
    billingInvoice: 'Fagitire ya Buri Kwezi',
    billingWallet: 'Imari ya Sosiyete',
    employeeRides: 'Inzira z\'Abakozi',
    monthlySpend: 'Amafaranga y\'Ukwezi',
    leaderboard: '🏆 Urutonde rw\'Abakomeye',
    topDrivers: 'Abashofer Bakomeye Iki Cyumweru',
    yourRank: 'Aho Uri mu Rutonde',
    offlineMode: '📡 Nta Murandasi',
    offlineMsg: 'Nta murandasi. Ukoresha amakuru yabitswe.',
    queuedRequest: 'Isaba ryategerejwe — rizohererezwa mugihe murandasi uboneka.',
    // ── In-app notification strings ──
    notif_wrongCreds: 'Nomero ya telefone cyangwa ijambo banga si ryo. Ongera ugerageze.',
    notif_noPhone: 'Shyiraho nomero yawe ya telefone.',
    notif_noPass: 'Shyiraho ijambo banga ryawe.',
    notif_noName: 'Shyiraho amazina yawe yombi.',
    notif_passMismatch2: 'Amagambo banga ntahuye. Reba hanyuma ugerageze.',
    notif_passShort: 'Ijambo banga rigomba kuba nibura inyuguti 6.',
    notif_phoneExists: 'Iyi nomero isanzwe yiyandikishije. Injira.',
    notif_allFields: 'Uzuza ibice byose bisabwa.',
    notif_noInternet: 'Nta murandasi. Reba iyunganira ryawe.',
    notif_backOnline: 'Wasubiye online! Ibisabwa byawe birahererejwe.',
    notif_locDenied: 'Kwemera aho uri byanze. Shyiraho muri Igenamiterere.',
    notif_locOff: 'Serivisi za GPS zifunze. Fungura GPS yawe.',
    notif_locGranted: '📍 Aho uri babonye. Murakaza neza kuri MotoLink!',
    notif_mapPin: '📌 Intego yahagijwe ku ikarita. Fata igihe kirekire guhindura.',
    notif_searchFail: 'Aho washakaga ntiboneka. Gerageza amagambo ahindutse.',
    notif_noGPS: 'Gutegereza GPS yawe...',
    notif_profileSaved: 'Umwirondoro wabitswe neza.',
    notif_paySetupDone: 'Amakuru y\'ubwishyu yabitswe! Ubu urashobora kwemera inzira.',
    notif_promoInvalid: 'Kode ntibaho cyangwa yarangiye.',
    notif_promoUsed: 'Warakoresheje kode iyi.',
    notif_promoOk: 'Kode ya promo yashyizweho! Igabanyizo ryongewe.',
    notif_scheduleNoTime: 'Hitamo itariki n\'amasaa y\'urugendo rwawe.',
    notif_schedulePast: 'Hitamo igihe kizaza k\'urugendo rwawe.',
    notif_rideQueued: 'Nta murandasi — isaba ryategerejwe.',
    notif_signupOk: 'Murakaza neza kuri MotoLink! Konti yawe iteguye.',
    notif_signoutOk: 'Wasohutse neza. Tuzabonana!',
    notif_deleteOk: 'Konti yasibwe. Murakaza neza gusubira.',
    notif_sosTitle: '🚨 SOS Yoherejwe',
    notif_sosSent: 'Itsinda ry\'umutekano ryamenyeshejwe. Ubufasha buragenda.',
    notif_cameraOff: 'Kamera ntiyemerewe. Shyiraho muri Igenamiterere.',
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
  const n = parseFloat(d); return (isNaN(n) || n === 0)?0: n <= 2?500: Math.round(500+(n-2)*150);
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

const reverseGeocode = async (lat, lon) => {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
      headers: {
        'User-Agent': 'MotoLink/1.0'
      }});
    const d = await r.json();
    if (!d?.address) return 'Current Location';
    const a = d.address;
    return a.road?`${a.road}${a.suburb?', '+a.suburb: ''}`: a.neighbourhood || a.suburb || a.quarter || a.city_district || d.display_name.split(',')[0];
  } catch {
    return 'Current Location';
  }
};

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
const saveSession = async (session, profile, role, lang) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({
      session, profile, role, lang
    }));
  } catch {}
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
const buildUSSD = (momoType, momoNumber, merchantCode, amount) => {
  const amt = Math.round(amount);
  if (momoType === 'merchant' && merchantCode) {
    // *182*8*1*{merchantCode}*{amount}#
    return `tel:*182*8*1*${merchantCode}*${amt}%23`;
  }
  // *182*1*1*{momoNumber}*{amount}#
  return `tel:*182*1*1*${momoNumber}*${amt}%23`;
};

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// 8. SMART SEARCH ENGINE
// ══════════════════════════════════════════════

// AI-powered query interpreter — expands vague/local queries before geocoding
const aiExpandQuery = async (query) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `You are a location assistant for Kigali, Rwanda. The user typed: "${query}". 
Return ONLY a JSON object like: {"queries":["query1","query2","query3"]} 
Generate 2-3 Nominatim-friendly search variants for this location in Kigali/Rwanda. 
Examples: "kk15" → ["KK 15 Ave Kigali","KK 15 Avenue Kigali Rwanda"], "kbc" → ["KBC Kigali","Rwanda Broadcasting Corporation Kigali"], "remera mosque" → ["Mosque Remera Kigali","Remera Mosque Rwanda Kigali"].
Handle: street codes (KK, KG, KN, RN numbers), landmarks, neighborhoods, short names, Kinyarwanda place names.
Return ONLY the JSON, no other text.`
        }]
      })
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return Array.isArray(parsed.queries) ? parsed.queries : [];
  } catch {
    return [];
  }
};

const nominatimFetch = async (q, extra = '') => {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q + extra)}&countrycodes=rw&addressdetails=1&limit=5&dedupe=1`,
      { headers: { 'User-Agent': 'MotoLink/1.0' } }
    );
    return await r.json();
  } catch { return []; }
};

const smartSearch = async (query) => {
  const q = query.trim();
  if (q.length < 2) return [];
  const ck = q.toLowerCase();
  if (searchCache[ck]) return searchCache[ck];

  try {
    // Round 1: standard Nominatim searches in parallel
    const [r1, r2] = await Promise.all([
      nominatimFetch(q),
      nominatimFetch(q, ', Rwanda'),
    ]);

    const seen = new Set();
    const merge = (arr) => arr.forEach(p => { if (!seen.has(p.place_id)) { seen.add(p.place_id); merged.push(p); } });
    const merged = [];
    merge(r1); merge(r2);

    // Round 2: if fewer than 2 results, try AI-expanded queries
    if (merged.length < 2) {
      const aiQueries = await aiExpandQuery(q);
      const aiResults = await Promise.all(aiQueries.map(aq => nominatimFetch(aq)));
      aiResults.forEach(arr => merge(arr));
    }

    // Round 3: if still empty, do a free-text fallback with Kigali context
    if (merged.length === 0) {
      const fallback = await nominatimFetch(q + ' Kigali');
      merge(fallback);
    }

    // Sort: exact prefix matches first
    merged.sort((a, b) => {
      const al = a.display_name.toLowerCase(), bl = b.display_name.toLowerCase();
      return (al.startsWith(ck) ? 0 : 1) - (bl.startsWith(ck) ? 0 : 1);
    });

    // If STILL no results, return a manual entry option the user can confirm
    if (merged.length === 0) {
      const fallbackEntry = [{
        place_id: 'manual_' + ck,
        display_name: q + ', Kigali, Rwanda',
        lat: '-1.9441',
        lon: '30.0619',
        address: { city: 'Kigali', country: 'Rwanda' },
        _isManual: true,
      }];
      searchCache[ck] = fallbackEntry;
      return fallbackEntry;
    }

    const results = merged.slice(0, 8);
    searchCache[ck] = results;
    return results;
  } catch {
    return [];
  }
};

const buildLabel = (place) => {
  if (place._isManual) return place.display_name;
  const a = place.address || {};
  return a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}${a.suburb ? ', ' + a.suburb : a.city ? ', ' + a.city : ''}`
    : a.neighbourhood ? `${a.neighbourhood}${a.suburb ? ', ' + a.suburb : ''}`
    : a.suburb ? `${a.suburb}${a.city ? ', ' + a.city : ''}`
    : a.village ? `${a.village}${a.county ? ', ' + a.county : ''}`
    : a.town ? `${a.town}${a.county ? ', ' + a.county : ''}`
    : a.city_district || place.display_name.split(',').slice(0, 2).join(',').trim();
};

// ══════════════════════════════════════════════
// 9. MAP ENGINE
// ══════════════════════════════════════════════
const MapComponent = ({
  myLoc,
  targetLoc,
  onLongPress
}) => {
  const webViewRef = useRef(null);
  const mapReady = useRef(false);
  const pending = useRef([]);

  const postMsg = (msg) => {
    if (mapReady.current && webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify(msg));
    } else {
      pending.current.push(msg);
    }
  };

  const onReady = () => {
    mapReady.current = true;
    pending.current.forEach(m => webViewRef.current?.postMessage(JSON.stringify(m)));
    pending.current = [];
    if (myLoc) postMsg( {
      type: 'UPDATE_LOC', lat: myLoc.latitude, lng: myLoc.longitude
    });
    if (targetLoc && myLoc) postMsg( {
      type: 'SET_TARGET', lat: targetLoc.latitude, lng: targetLoc.longitude, myLat: myLoc.latitude, myLng: myLoc.longitude
    });
  };

  useEffect(()=> {
    if (myLoc) postMsg( {
      type: 'UPDATE_LOC', lat: myLoc.latitude, lng: myLoc.longitude
    });
  },
    [myLoc]);
  useEffect(()=> {
    if (targetLoc && myLoc) postMsg( {
      type: 'SET_TARGET', lat: targetLoc.latitude, lng: targetLoc.longitude, myLat: myLoc.latitude, myLng: myLoc.longitude
    });
    else postMsg( {
      type: 'CLEAR_TARGET'
    });
  },
    [targetLoc]);

  const html = `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
  *{box-sizing:border-box;}html,body{padding:0;margin:0;height:100%;width:100%;background:#0A0A0A;overflow:hidden;}
  #map{height:100%;width:100%;position:absolute;top:0;left:0;}
  .leaflet-control-attribution{display:none!important;}
  @keyframes pulse{0%{transform:scale(1);opacity:0.9}50%{transform:scale(1.6);opacity:0.4}100%{transform:scale(2.2);opacity:0}}
  .pr{border:2.5px solid #D4AF37;border-radius:50%;width:24px;height:24px;animation:pulse 2s ease-out infinite;position:absolute;top:-5px;left:-5px;pointer-events:none;}
  </style></head><body><div id="map"></div><script>
  var tileUrls=['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png','https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'];
  var ti=0;
  var map=L.map('map',{zoomControl:false,preferCanvas:true,renderer:L.canvas(),fadeAnimation:false,markerZoomAnimation:true,zoomSnap:0.5}).setView([${myLoc?.latitude||-1.9441},${myLoc?.longitude || 30.0619}],16);
  function mkTile(u){return L.tileLayer(u,{maxZoom:20,maxNativeZoom:19,keepBuffer:4,updateWhenZooming:false,updateWhenIdle:false,tileSize:256,detectRetina:true,crossOrigin:true});}
  var tl=mkTile(tileUrls[0]);tl.addTo(map);
  tl.on('tileerror',function(){if(ti<tileUrls.length-1){ti++;map.removeLayer(tl);tl=mkTile(tileUrls[ti]);tl.addTo(map);}});
  var myIcon=L.divIcon({className:'',html:'<div style="position:relative;width:14px;height:14px;"><div class="pr"></div><div style="background:#D4AF37;width:14px;height:14px;border-radius:50%;border:2.5px solid #0A0A0A;box-shadow:0 0 10px rgba(212,175,55,0.9);position:relative;z-index:2;"></div></div>',iconSize:[14,14],iconAnchor:[7,7]});
  var tgIcon=L.divIcon({className:'',html:'<div style="background:#2ECC71;width:18px;height:18px;border-radius:50%;border:2.5px solid #0A0A0A;box-shadow:0 0 12px rgba(46,204,113,0.9);"></div>',iconSize:[18,18],iconAnchor:[9,9]});
  var lpIcon=L.divIcon({className:'',html:'<div style="display:flex;flex-direction:column;align-items:center;"><div style="background:#FF4C4C;width:22px;height:22px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 14px rgba(255,76,76,0.9);display:flex;align-items:center;justify-content:center;"><span style="font-size:12px;">📌</span></div><div style="width:2px;height:10px;background:#FF4C4C;margin-top:-1px;"></div></div>',iconSize:[22,32],iconAnchor:[11,32]});
  var myMk=L.marker([${myLoc?.latitude||-1.9441},${myLoc?.longitude || 30.0619}],{icon:myIcon,zIndexOffset:1000}).addTo(map);
  var tgMk=null,lpMk=null,rl=null,rls=null;var init=false;
  // Long-press to set destination
  var lpTimer=null;
  map.on('mousedown touchstart',function(e){
    var ll=e.latlng;
    lpTimer=setTimeout(function(){
      if(lpMk){map.removeLayer(lpMk);}
      lpMk=L.marker([ll.lat,ll.lng],{icon:lpIcon,zIndexOffset:800}).addTo(map);
      lpMk.bindPopup('<b style="color:#FF4C4C">📌 Long-press destination</b><br><small>'+ll.lat.toFixed(5)+', '+ll.lng.toFixed(5)+'</small>').openPopup();
      window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'LONG_PRESS',lat:ll.lat,lng:ll.lng}));
    },600);
  });
  map.on('mouseup touchend mousemove',function(){if(lpTimer){clearTimeout(lpTimer);lpTimer=null;}});
  function drawRoute(mla,mln,tla,tln){
  if(rls){map.removeLayer(rls);rls=null;}if(rl){map.removeLayer(rl);rl=null;}
  rls=L.polyline([[mla,mln],[tla,tln]],{color:'rgba(212,175,55,0.2)',weight:7,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
  rl=L.polyline([[mla,mln],[tla,tln]],{color:'#D4AF37',dashArray:'10,7',weight:3.5,opacity:1,lineCap:'round',lineJoin:'round',interactive:false}).addTo(map);
  }
  function clearRoute(){if(rls){map.removeLayer(rls);rls=null;}if(rl){map.removeLayer(rl);rl=null;}}
  var mh=function(e){
  try{var d=JSON.parse(typeof e.data==='string'?e.data:JSON.stringify(e.data));
  if(d.type==='UPDATE_LOC'){var la=parseFloat(d.lat),ln=parseFloat(d.lng);if(isNaN(la)||isNaN(ln))return;myMk.setLatLng([la,ln]);if(!init){map.setView([la,ln],16,{animate:false});init=true;}else if(!tgMk){map.panTo([la,ln],{animate:true,duration:0.5});}if(rl&&tgMk){var tl2=tgMk.getLatLng();clearRoute();drawRoute(la,ln,tl2.lat,tl2.lng);}}
  if(d.type==='SET_TARGET'){var tla=parseFloat(d.lat),tln=parseFloat(d.lng),mla=parseFloat(d.myLat),mln=parseFloat(d.myLng);if(isNaN(tla)||isNaN(tln)||isNaN(mla)||isNaN(mln))return;if(tgMk){map.removeLayer(tgMk);tgMk=null;}clearRoute();tgMk=L.marker([tla,tln],{icon:tgIcon,zIndexOffset:900}).addTo(map);drawRoute(mla,mln,tla,tln);setTimeout(function(){var g=new L.featureGroup([myMk,tgMk]);map.fitBounds(g.getBounds().pad(0.3),{animate:true,duration:0.8,maxZoom:16});},100);}
  if(d.type==='CLEAR_TARGET'){if(tgMk){map.removeLayer(tgMk);tgMk=null;}clearRoute();var p=myMk.getLatLng();map.setView([p.lat,p.lng],16,{animate:true,duration:0.6});}
  }catch(err){}
  };
  document.addEventListener('message',mh);window.addEventListener('message',mh);
  setTimeout(function(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'MAP_READY'}));},800);
  </script></body></html>`;

  // Web fallback — use OSM embed iframe since WebView is not available on web
  if (Platform.OS === 'web') {
    const lat = myLoc?.latitude || -1.9441;
    const lng = myLoc?.longitude || 30.0619;
    const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.02}%2C${lat-0.02}%2C${lng+0.02}%2C${lat+0.02}&layer=mapnik&marker=${lat}%2C${lng}`;
    return (
      <View style={styles.map}>
        {React.createElement('iframe', {
          src: mapSrc,
          title: 'MotoLink Map',
          style: {
            width: '100%', height: '100%', border: 'none', backgroundColor: '#0A0A0A'
          },
        })}
      </View>
    );
  }

  return (
    <WebView ref={webViewRef} originWhitelist={['*']} source={ { html }} style={styles.map}
      scrollEnabled={false} bounces={false} overScrollMode="never"
      javaScriptEnabled domStorageEnabled startInLoadingState={false}
      renderLoading={()=><View style={[styles.map,
        { backgroundColor: C.black }]} />}
      onMessage={e=> {
        try {
          const m = JSON.parse(e.nativeEvent.data);
          if (m.type === 'MAP_READY') onReady();
          if (m.type === 'LONG_PRESS' && onLongPress) {
            onLongPress({ latitude: m.lat, longitude: m.lng });
          }
        }catch {}
      }}
      onError={()=> {
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
    icon: '🛵', accent: C.gold, label: 'RIDE'
  },
  accepted: {
    icon: '✅', accent: C.green, label: 'ACCEPTED'
  },
  cancelled: {
    icon: '❌', accent: C.red, label: 'ALERT'
  },
  completed: {
    icon: '🎉', accent: C.green, label: 'DONE'
  },
  search: {
    icon: '🔍', accent: C.blue, label: 'INFO'
  },
  rated: {
    icon: '⭐', accent: C.gold, label: 'RATING'
  },
  payment: {
    icon: '💰', accent: C.blue, label: 'PAYMENT'
  },
  sos: {
    icon: '🚨', accent: C.red, label: 'SOS'
  },
  error: {
    icon: '⚠️', accent: C.red, label: 'ERROR'
  },
  warning: {
    icon: '⚠️', accent: C.orange, label: 'WARNING'
  },
  success: {
    icon: '✓', accent: C.green, label: 'SUCCESS'
  },
  location: {
    icon: '📍', accent: C.blue, label: 'GPS'
  },
  offline: {
    icon: '📡', accent: C.orange, label: 'OFFLINE'
  },
  online: {
    icon: '🌐', accent: C.green, label: 'ONLINE'
  },
  wallet: {
    icon: '💳', accent: C.gold, label: 'WALLET'
  },
  default: {
    icon: '🔔', accent: C.gold, label: 'MOTOLINK'
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
            style={{ position: 'absolute', top: 6, right: 10, zIndex: 2, padding: 4 }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>✕</Text>
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
    visible, trip, role, t, onSubmit, onSkip
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
  // 12. PAYMENT POPUP MODAL
  //     Shown to passenger after confirming complete
  // ══════════════════════════════════════════════
  const PaymentModal = ({
    visible,
    trip,
    driverProfile,
    t,
    onPaid,
    onCash,
    onClose
  }) => {
    const [method, setMethod] = useState(null); // null | 'cash' | 'momo'
    const [paid, setPaid] = useState(false);

    useEffect(()=> {
      if (visible) {
        setMethod(null); setPaid(false);
      }
    },
      [visible]);

    const handleMomoTap = () => {
      if (!driverProfile?.momo_number && !driverProfile?.momo_merchant_code) {
        showBanner('⚠️ MotoLink', t.noPaymentWarning, 'warning');
        return;
      }
      const ussd = buildUSSD(
        driverProfile.momo_type,
        driverProfile.momo_number,
        driverProfile.momo_merchant_code,
        trip?.price || 0
      );
      Linking.openURL(ussd).catch(() => showBanner('MotoLink', 'Could not open USSD. Please dial manually.', 'error'));
      setPaid(true);
    };

    const momoLabel = driverProfile?.momo_type === 'merchant'
    ? `${t.payMerchant}\n${driverProfile?.momo_merchant_code}`: `${t.payMomo}\n${driverProfile?.momo_number}`;

    return (
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.payModal}>
            {/* Header */}
            <View style={ { alignItems: 'center', marginBottom: 20 }}>
              <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
              <Text style={styles.payModalTitle}>{t.choosePayment}</Text>
              <Text style={ { color: C.gold, fontSize: 24, fontWeight: '900', marginTop: 8 }}>{fmtFRW(trip?.price || 0)}</Text>
            </View>

            {/* Route summary */}
            {trip && (
              <View style={[styles.rateTripSummary, { marginBottom: 20 }]}>
                <View style={styles.routeBlock}><View style={styles.routeDot} /><Text style={ { color: C.gray, fontSize: 12, flex: 1 }} numberOfLines={1}>{trip.pickup_address}</Text></View>
                <View style={styles.routeLine_} />
                <View style={styles.routeBlock}><View style={[styles.routeDot, { backgroundColor: C.green }]} /><Text style={ { color: C.offWhite, fontSize: 12, flex: 1 }} numberOfLines={1}>{trip.destination_address}</Text></View>
              </View>
            )}

            {/* Driver payment info */}
            {driverProfile && (
              <View style={styles.driverPayInfo}>
                <Text style={styles.driverPayLabel}>{t.paymentInfo}</Text>
                <Text style={ { color: C.white, fontWeight: '800', fontSize: 14, marginTop: 4 }}>{driverProfile.momo_name}</Text>
                <Text style={ { color: C.gray, fontSize: 12, marginTop: 2 }}>
                  {driverProfile.momo_type === 'merchant'
                  ? `${t.merchantCode}: ${driverProfile.momo_merchant_code}`: `${t.momoNumber}: ${driverProfile.momo_number}`}
                </Text>
              </View>
            )}

            {/* Payment choice */}
            {!method && (
              <View style={ { gap: 12, marginTop: 8 }}>
                {/* MoMo Tap */}
                <TouchableOpacity style={styles.payOptionBtn} onPress={()=> { setMethod('momo'); handleMomoTap(); }}>
                  <View style={ { flex: 1 }}>
                    <Text style={styles.payOptionTitle}>{t.momoTap}</Text>
                    <Text style={styles.payOptionSub}>{momoLabel}</Text>
                  </View>
                  <View style={[styles.payOptionBadge, { backgroundColor: 'rgba(255,204,0,0.15)', borderColor: C.mtn }]}>
                    <Text style={ { color: C.mtn, fontWeight: '900', fontSize: 11 }}>MTN</Text>
                  </View>
                </TouchableOpacity>

                {/* Cash */}
                <TouchableOpacity style={[styles.payOptionBtn, { borderColor: C.borderFaint }]} onPress={()=> { setMethod('cash'); onCash(); }}>
                  <View style={ { flex: 1 }}>
                    <Text style={styles.payOptionTitle}>{t.cash}</Text>
                    <Text style={styles.payOptionSub}>{t.fareLabel}: {fmtFRW(trip?.price || 0)}</Text>
                  </View>
                  <Text style={ { fontSize: 24 }}>💵</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* After MoMo tap — confirm paid */}
            {method === 'momo' && (
              <View style={ { gap: 12, marginTop: 8 }}>
                <View style={styles.ussdInfoBox}>
                  <Text style={ { color: C.gold, fontWeight: '700', fontSize: 13 }}>📲 USSD {t.tapToPay}</Text>
                  <Text style={ { color: C.gray, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
                    {driverProfile?.momo_type === 'merchant'
                    ? `*182*8*1*${driverProfile?.momo_merchant_code}*${trip?.price}#`: `*182*1*1*${driverProfile?.momo_number}*${trip?.price}#`}
                  </Text>
                  <TouchableOpacity style={[styles.mainBtn, { marginTop: 12 }]} onPress={handleMomoTap}>
                    <Text style={styles.mainBtnTxt}>{t.tapToPay} 📲</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[styles.mainBtn, { backgroundColor: C.green }]} onPress={()=> { setPaid(true); onPaid('momo'); }}>
                  <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.paidBtn}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    );
  };

  // ══════════════════════════════════════════════
  // 13. DRIVER PAYMENT SETUP MODAL
  // ══════════════════════════════════════════════
  const PaymentSetupModal = ({
    visible, profile, t, onSave, onClose
  }) => {
    const [momoType,
      setMomoType] = useState(profile?.momo_type || 'personal');
    const [momoNum,
      setMomoNum] = useState(profile?.momo_number || '');
    const [merchantCode,
      setMerchantCode] = useState(profile?.momo_merchant_code || '');
    const [momoName,
      setMomoName] = useState(profile?.momo_name || '');
    const [loading,
      setLoading] = useState(false);

    const handleSave = async()=> {
      if (!momoName) return showBanner('MotoLink', t.accountHolder + ' required', 'warning');
      if (momoType === 'personal' && !momoNum) return showBanner('MotoLink', t.momoNumber + ' required', 'warning');
      if (momoType === 'merchant' && !merchantCode) return showBanner('MotoLink', t.merchantCode + ' required', 'warning');
      setLoading(true);
      await onSave( {
        momo_type: momoType, momo_number: momoNum, momo_merchant_code: merchantCode, momo_name: momoName
      });
      setLoading(false);
      onClose();
    };

    return (
      <Modal visible={visible} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios'?'padding': 'height'} style={ { flex: 1 }}>
          <View style={styles.modalBg}>
            <ScrollView contentContainerStyle={styles.glassModal} keyboardShouldPersistTaps="handled">
              <View style={ { alignItems: 'center', marginBottom: 20 }}>
                <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
                <Text style={[styles.splashTitle, { fontSize: 20 }]}>{t.paymentSetup}</Text>
                <Text style={ { color: C.gray, fontSize: 13, textAlign: 'center', marginTop: 6 }}>{t.paymentRequired}</Text>
              </View>

              {/* Type toggle */}
              <Text style={styles.inputLabel}>{t.momoType}</Text>
              <View style={ { flexDirection: 'row', gap: 10, marginBottom: 20 }}>
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

              {/* Preview USSD */}
              <View style={styles.ussdInfoBox}>
                <Text style={ { color: C.gold, fontWeight: '700', fontSize: 12 }}>USSD Preview</Text>
                <Text style={ { color: C.gray, fontSize: 12, marginTop: 4, fontFamily: 'monospace' }}>
                  {momoType === 'merchant'?`*182*8*1*${merchantCode || 'CODE'}*AMOUNT#`: `*182*1*1*${momoNum || 'NUMBER'}*AMOUNT#`}
                </Text>
              </View>

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
    <div class="row"><span class="label">Payment Method</span><span class="value">${trip.payment_method === 'momo'?'📲 MTN MoMo': '💵 Cash'}</span></div>
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
      `💳 Payment: ${trip.payment_method === 'momo'?'MTN MoMo': 'Cash'}\n` +
      (isDriver ? `📊 Your earnings: ${driverEarn.toLocaleString()} FRW\n`: '') +
      `⭐ Rating: ${starsStr}\n\n` +
      `🏍️ Driver: ${trip.driver_name || '—'}\n` +
      `👤 Passenger: ${trip.passenger_name || '—'}\n\n` +
      `🔑 Trip ID: ${trip.id?.substring(0, 12)}...\n` +
      `_MotoLink — The Future of Ride-Hailing_`
    );
    Linking.openURL(`whatsapp://send?text=${msg}`)
    .catch(() => showBanner('MotoLink', 'WhatsApp not found. Please install WhatsApp.', 'error'));
  };

  // ══════════════════════════════════════════════
  // TRIP HISTORY MODAL
  // ══════════════════════════════════════════════
  const TripHistoryModal = ({
    visible, onClose, userId, role, t, onCompleteTrip, onCancelTrip, onConfirmPayment
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
                              {trip.payment_method === 'momo'?'📲 MTN MoMo': '💵 Cash'}
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
    driverId, t
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

  // ══════════════════════════════════════════════
  // SOS BUTTON — draggable, always visible
  // ══════════════════════════════════════════════
  const SOSButton = ({
    onPress
  }) => {
    const pulse = useRef(new Animated.Value(1)).current;
    const pan = useRef(new Animated.ValueXY({
      x: width - 76, y: height * 0.45
    })).current;
    const isDrag = useRef(false);
    const lastTap = useRef(0);

    useEffect(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.28, duration: 900, useNativeDriver: true
          }),
          Animated.timing(pulse, {
            toValue: 1, duration: 900, useNativeDriver: true
          }),
        ])
      ).start();
    }, []);

    const panResponder = useRef(Platform.OS !== 'web' ? PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: pan.x._value, y: pan.y._value
        });
        pan.setValue({
          x: 0, y: 0
        });
        isDrag.current = false;
      },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5) isDrag.current = true;
        Animated.event([null, {
          dx: pan.x, dy: pan.y
        }], {
          useNativeDriver: false
        })(_, g);
      },
      onPanResponderRelease: (_, g) => {
        pan.flattenOffset();
        // Clamp inside screen bounds
        const btnSize = 56;
        const clampX = Math.max(10, Math.min(width - btnSize - 10, pan.x._value));
        const clampY = Math.max(80, Math.min(height - btnSize - 100, pan.y._value));
        Animated.spring(pan, {
          toValue: {
            x: clampX, y: clampY
          }, useNativeDriver: false, friction: 7
        }).start();
        // Only fire onPress if it wasn't a drag
        if (!isDrag.current) onPress();
      },
    }): {
      panHandlers: {}
    }).current;

    return (
      <Animated.View
        style={[styles.sosBtn, { left: pan.x, top: pan.y, zIndex: 8888, elevation: 30 }]}
        {...panResponder.panHandlers}
        >
        <Animated.View style={[styles.sosPulse, { transform: [{ scale: pulse }] }]} />
        <Text style={styles.sosBtnTxt}>SOS</Text>
      </Animated.View>
    );
  };

  // ══════════════════════════════════════════════
  const MorphingMenu = ({
    isOpen, onPress
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

    const menuAnim = useRef(new Animated.Value(-900)).current;
    const searchTimer = useRef(null);
    const appStateRef = useRef(Platform.OS !== 'web' ? AppState.currentState: 'active');

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
        next=> {
          if (appStateRef.current.match(/inactive|background/) && next === 'active' && state.session) syncData();
          appStateRef.current = next;
        });
      return ()=>sub.remove();
    }, [state.session]);

    // ─── Hardware back ───────────────────────
    useEffect(()=> {
      const onBack = ()=> {
        if (historyModal) {
          setHistoryModal(false); return true;
        }
        if (sosModal) {
          setSosModal(false); return true;
        }
        if (paymentModal) return true;
        if (ratingModal) return true;
        if (paySetupModal) {
          setPaySetupModal(false); return true;
        }
        if (profileModal) {
          setProfileModal(false); return true;
        }
        if (state.menuOpen) {
          dispatch( {
            type: 'TOGGLE_MENU'
          }); return true;
        }
        if (suggestions.length > 0) {
          setSuggestions([]); return true;
        }
        if (destCoords&&!state.activeTrip) {
          setDestCoords(null); setTargetLocation(null); return true;
        }
        return false;
      };
      if (Platform.OS === 'web') return;
      const h = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => h.remove();
    },
      [sosModal,
        paymentModal,
        ratingModal,
        paySetupModal,
        profileModal,
        state.menuOpen,
        suggestions,
        destCoords,
        state.activeTrip]);

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

    // ─── Scheduled trip notifier (every minute) ─
    useEffect(() => {
      if (state.step !== 'app' || state.role !== 'driver') return;
      const checkScheduled = async () => {
        const soon = new Date(Date.now() + SCHEDULED_NOTIFY_MIN * 60 * 1000).toISOString();
        const now = new Date().toISOString();
        const {
          data: scheduled
        } = await supabase.from('trips')
        .select('*').eq('status', 'scheduled').is('pre_accepted_by', null)
        .gte('scheduled_for', now).lte('scheduled_for', soon);
        if (scheduled?.length > 0) {
          for (const trip of scheduled) {
            notify(
              `📅 ${t.scheduledTrip}`,
              `${trip.passenger_name}: ${trip.pickup_address} → ${trip.destination_address} — in ${SCHEDULED_NOTIFY_MIN} min`,
              'ride'
            );
          }
        }
      };
      checkScheduled();
      const interval = setInterval(checkScheduled, 60 * 1000);
      return () => clearInterval(interval);
    },
      [state.step,
        state.role,
        t]);

    // ─── Load leaderboard ────────────────────
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
      // Use native Alert only for destructive confirm — no suitable showBanner alternative
      Alert.alert('⚠️ ' + t.deleteAcc, 'This permanently deletes your account.',
        [{
          text: t.cancel, style: 'cancel'
        },
          {
            text: t.deleteAcc, style: 'destructive', onPress: async () => {
              if (!state.session?.user?.id) return;
              await supabase.from('trips').update({
                status: 'cancelled'
              })
              .eq(state.role === 'passenger' ? 'passenger_id': 'driver_id', state.session.user.id)
              .in('status', ['searching', 'accepted']);
              const {
                error
              } = await supabase.from('profiles').delete().eq('id', state.session.user.id);
              if (error) {
                showBanner('MotoLink', 'Could not delete account. Try again.', 'error');
              } else {
                showBanner('MotoLink', t.notif_deleteOk, 'success');
                await clearSession(); setProfileModal(false); dispatch( {
                  type: 'LOGOUT'
                });
              }
            }}]
      );
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
      const loc = state.myLocation;
      const profile = state.profile;
      const trip = state.activeTrip;
      const name = profile?.name || 'Unknown';
      const phone = state.session?.user?.phone || '';
      const role = state.role;
      const lat = loc?.latitude || 0;
      const lng = loc?.longitude || 0;
      const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
      const tripInfo = trip ? `\nTrip ID: ${trip.id}\nDriver: ${trip.driver_name || '—'}\nPassenger: ${trip.passenger_name || '—'}`: '';

      // 1. Log SOS to Supabase
      await supabase.from('sos_logs').insert([{
        user_id: state.session?.user?.id,
        user_name: name,
        user_phone: phone,
        user_role: role,
        latitude: lat,
        longitude: lng,
        trip_id: trip?.id || null,
      }]);

      // 2. Push admin immediately
      const {
        data: adminTokens
      } = await supabase.from('profiles')
      .select('push_token').eq('role', 'admin').not('push_token', 'is', null);
      for (const a of (adminTokens || [])) {
        if (a.push_token) await sendExpoPush(
          a.push_token,
          `🚨 SOS — ${name} (${role})`,
          `📍 ${mapsUrl}${tripInfo}`,
          {
            type: 'sos'
          }
        );
      }

      // 3. WhatsApp to MotoLink safety number
      const safetyMsg = encodeURIComponent(
        `🚨 *MOTOLINK SOS ALERT*\n\n` +
        `Name: ${name}\nPhone: ${phone}\nRole: ${role}\n` +
        `📍 Location: ${mapsUrl}` +
        tripInfo +
        `\n\nTime: ${new Date().toLocaleString()}`
      );
      await Linking.openURL(`whatsapp://send?phone=${SOS_SAFETY_NUMBER.replace('+', '')}&text=${safetyMsg}`)
      .catch(() => {});

      // 4. WhatsApp to personal emergency contact
      if (profile?.emergency_phone) {
        const emergencyMsg = encodeURIComponent(
          `🚨 *EMERGENCY — ${name} needs help!*\n\n` +
          `${name} has triggered an emergency SOS on MotoLink.\n\n` +
          `📍 Their location: ${mapsUrl}\n` +
          `📞 Their phone: ${phone}\n\n` +
          `Please contact them immediately or call emergency services.`
        );
        await Linking.openURL(`whatsapp://send?phone=${profile.emergency_phone.replace('+', '')}&text=${emergencyMsg}`)
        .catch(() => {});
      }

      // 5. Call safety number directly
      setTimeout(() => {
        Linking.openURL(`tel:${SOS_SAFETY_NUMBER}`).catch(() => {});
      }, 1500);

      showBanner(t.notif_sosTitle, t.notif_sosSent, 'sos');
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
    useEffect(() => {
      if (state.step !== 'app') return;
      if (Platform.OS === 'web') return;
      let sub;
      let gpsOkShown = false;
      let gpsRetryTimer = null;

      const startWatching = async () => {
        try {
          // ── 1. Check / request permission ──────────────
          let { status } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted') {
            const req = await Location.requestForegroundPermissionsAsync();
            status = req.status;
          }
          if (status !== 'granted') {
            showBanner('📍 MotoLink', t.notif_locDenied, 'error');
            // Show a persistent alert guiding user to Settings
            Alert.alert(
              '📍 ' + (t.notif_locDenied?.split('.')[0] || 'Location Required'),
              t.notif_locDenied,
              [
                { text: t.close || 'Close', style: 'cancel' },
                {
                  text: 'Open Settings', onPress: () => {
                    if (Platform.OS === 'ios') Linking.openURL('app-settings:');
                    else Linking.openSettings?.().catch(() => Linking.openURL('package:com.motolink'));
                  }
                },
              ]
            );
            return;
          }

          // ── 2. Check GPS hardware switch ───────────────
          const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
          if (!enabled) {
            showBanner('📍 GPS', t.notif_locOff, 'warning');
            // Poll every 5 s until user turns GPS on
            gpsRetryTimer = setInterval(async () => {
              const nowEnabled = await Location.hasServicesEnabledAsync().catch(() => false);
              if (nowEnabled) {
                clearInterval(gpsRetryTimer);
                gpsRetryTimer = null;
                startWatching(); // restart
              }
            }, 5000);
            return;
          }

          // ── 3. Start watching ──────────────────────────
          sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 3000 },
            async (loc) => {
              const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
              dispatch({ type: 'SET_LOCATION', p: coords });
              if (!gpsOkShown) {
                gpsOkShown = true;
                showBanner('📍 MotoLink', t.notif_locGranted, 'location');
              }
              if (state.role === 'driver' && state.session) {
                await supabase.from('profiles').update({
                  current_lat: coords.latitude, current_lng: coords.longitude,
                }).eq('id', state.session.user.id);
              }
            }
          );
        } catch (err) {
          console.warn('[MotoLink] Location error:', err);
          showBanner('📍 GPS', t.notif_locOff, 'warning');
        }
      };

      startWatching();
      return () => {
        sub?.remove();
        if (gpsRetryTimer) clearInterval(gpsRetryTimer);
      };
    }, [state.step, state.session, state.role]);

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

    useEffect(()=> {
      if (!state.session) return;
      syncData();
      const sub = supabase.channel('moto_rt_v4')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'trips'
      }, async(payload)=> {
        syncData();
        const nw = payload.new;
        const ol = payload.old;

        // Passenger events
        if (state.role === 'passenger' && nw?.passenger_id === state.session.user.id) {
          if (nw.status === 'accepted' && ol?.status === 'searching') {
            notify('🏍️ '+t.accepted, `${nw.driver_name || 'Driver'} ${t.accepted.toLowerCase()}.`, 'accepted');
            const {
              data: drv
            } = await supabase.from('profiles').select('current_lat,current_lng').eq('id', nw.driver_id).single();
            if (drv) setTargetLocation({
              latitude: drv.current_lat, longitude: drv.current_lng
            });
          }
          if (nw.status === 'completion_requested') {
            notify('🏁 '+t.confirmComplete, t.completionRequested, 'completed');
          }
          if (nw.status === 'cancelled') {
            notify('❌ '+t.cancel, t.cancelledAt, 'cancelled'); setTargetLocation(null);
          }
          dispatch( {
            type: 'SET_ACTIVE_TRIP', p: (['cancelled', 'completed'].includes(nw.status))?null: nw
          });
        }

        // Driver events
        if (state.role === 'driver') {
          if (payload.eventType === 'INSERT' && nw.status === 'searching') {
            notify('🚨 New '+t.availJobs, `${nw.passenger_name}: ${nw.pickup_address} → ${nw.destination_address}`, 'ride');
          }
          if (nw.status === 'awaiting_driver_confirm' && state.activeTrip?.id === nw.id) {
            notify('💰 '+t.driverConfirm, t.paymentReceived, 'payment');
            dispatch( {
              type: 'SET_ACTIVE_TRIP', p: nw
            });
          }
          if (nw.status === 'cancelled' && state.activeTrip?.id === nw.id) {
            notify('❌ '+t.cancel, t.cancelledAt, 'cancelled');
            dispatch( {
              type: 'SET_ACTIVE_TRIP', p: null
            }); setTargetLocation(null);
          }
        }
      }).subscribe();
      return ()=>supabase.removeChannel(sub);
    }, [state.session, state.role, state.activeTrip, t]);

    // ══════════════════════════════════════════
    // SEARCH
    // ══════════════════════════════════════════
    const handleSearchInput = (text) => {
      setSearchQuery(text);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (text.length < 2) { setSuggestions([]); return; }
      setSearchLoading(true);
      searchTimer.current = setTimeout(async () => {
        const r = await smartSearch(text);
        setSuggestions(r);
        setSearchLoading(false);
        // If still empty after all fallbacks, show banner
        if (r.length === 0) {
          showBanner('🔍 MotoLink', t.notif_searchFail, 'warning');
        }
      }, 320);
    };

    const triggerSearch = async () => {
      if (searchQuery.length >= 2) {
        setSearchLoading(true);
        const r = await smartSearch(searchQuery);
        setSuggestions(r);
        setSearchLoading(false);
        if (r.length === 0) {
          showBanner('🔍 MotoLink', t.notif_searchFail, 'warning');
        }
      }
    };

    const selectDestination = (place)=> {
      const coords = {
        latitude: parseFloat(place.lat),
        longitude: parseFloat(place.lon)};
      setDestCoords(coords); setTargetLocation(coords);
      const label = buildLabel(place);
      setDestName(label); setSearchQuery(label); setSuggestions([]); Keyboard.dismiss();
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
      const currentSurge = await getSurgeMultiplier();
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
        // B2B company billing
        company_id: state.profile?.company_id || null,
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
    const acceptTrip = async(job)=> {
      // Check driver has payment info
      if (!state.profile?.momo_number&&!state.profile?.momo_merchant_code) {
        showBanner('⚠️ ' + t.paymentSetup, t.noPaymentWarning, 'warning');
        setTimeout(() => setPaySetupModal(true), 600);
        return;
      }
      const {
        error
      } = await supabase.from('trips').update({
          status: 'accepted', driver_id: state.session.user.id, driver_phone: state.session.user.phone,
          driver_name: state.profile?.name || 'Driver', accepted_at: new Date().toISOString(),
        }).eq('id', job.id);
      if (!error) {
        dispatch( {
          type: 'SET_ACTIVE_TRIP', p: {
            ...job, driver_id: state.session.user.id
          }});
        setTargetLocation({
          latitude: job.pickup_lat, longitude: job.pickup_lng
        });
        const tk = await getPushToken(job.passenger_id);
        await sendExpoPush(tk, '🏍️ '+t.accepted, `${state.profile?.name || 'Driver'} ${t.accepted.toLowerCase()}.`, {
          type: 'accepted'
        });
      }
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

    // ── Pre-accept a scheduled trip ───────────
    const preAcceptScheduledTrip = async (tripId) => {
      const {
        error
      } = await supabase.from('trips').update({
          pre_accepted_by: state.session.user.id,
          driver_id: state.session.user.id,
          driver_name: state.profile?.name || 'Driver',
          driver_phone: state.session.user.phone,
        }).eq('id', tripId);
      if (!error) {
        showBanner('📅 ' + t.preAccept, t.scheduledTrip, 'accepted');
        syncData();
      }
    };

    // Passenger confirms complete → shows payment modal
    const passengerConfirmComplete = async()=> {
      if (!state.activeTrip) return;
      // Fetch driver payment profile
      const {
        data: drvPay
      } = await supabase.from('profiles').select('momo_type,momo_number,momo_merchant_code,momo_name').eq('id', state.activeTrip.driver_id).single();
      setDriverPayProfile(drvPay);
      setPaymentModal(true);
      await supabase.from('trips').update({
        passenger_confirmed_at: new Date().toISOString()}).eq('id', state.activeTrip.id);
      dispatch( {
        type: 'SET_ACTIVE_TRIP', p: {
          ...state.activeTrip, status: 'completion_requested', passenger_confirmed_at: new Date().toISOString()}});
    };

    // Passenger confirms paid (MoMo or cash)
    const passengerConfirmedPayment = async(method)=> {
      setPaymentModal(false);
      if (!state.activeTrip) return;
      await supabase.from('trips').update({
        status: 'awaiting_driver_confirm',
        momo_payment_method: method,
        payment_status: method === 'momo'?'paid_momo': 'paid_cash',
      }).eq('id', state.activeTrip.id);
      dispatch( {
        type: 'SET_ACTIVE_TRIP', p: {
          ...state.activeTrip, status: 'awaiting_driver_confirm'
        }});
      const tk = await getPushToken(state.activeTrip.driver_id);
      await sendExpoPush(tk, '💰 '+t.driverConfirm, t.paymentReceived, {
        type: 'payment'
      });
      showBanner('✓', t.awaitingDriverConfirm, 'payment');
      // Prompt rating for passenger
      const {
        data: ct
      } = await supabase.from('trips').select('*').eq('id', state.activeTrip.id).single();
      if (ct&&!ct.rated_by_passenger) {
        setTripToRate(ct); setTimeout(()=>setRatingModal(true), 1200);
      }
    };

    // Driver confirms payment received → trip complete
    const driverConfirmPayment = async()=> {
      if (!state.activeTrip) return;
      const passId = state.activeTrip.passenger_id;
      await supabase.from('trips').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        driver_confirmed_at: new Date().toISOString(),
        payment_status: 'completed',
      }).eq('id', state.activeTrip.id);
      showBanner('🎉 '+t.completeTrip, t.paymentReceived, 'completed');
      dispatch( {
        type: 'SET_ACTIVE_TRIP', p: null
      }); setTargetLocation(null);
      const tk = await getPushToken(passId);
      await sendExpoPush(tk, '🎉 '+t.completeTrip, t.excellent, {
        type: 'completed'
      });
      // Prompt driver to rate passenger
      const {
        data: ct
      } = await supabase.from('trips').select('*').eq('id', state.activeTrip?.id).single();
      if (ct&&!ct.rated_by_driver) {
        setTripToRate(ct); setTimeout(()=>setRatingModal(true), 800);
      }
    };

    const cancelTrip = async(id, otherUserId = null)=> {
      await supabase.from('trips').update({
        status: 'cancelled', cancelled_at: new Date().toISOString()}).eq('id', id);
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios'?'padding': 'height'}
        style={ { flex: 1, backgroundColor: C.black }}>
        <ScrollView contentContainerStyle={styles.authView} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={ { alignItems: 'center', marginBottom: 8 }}>
            <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
            <Text style={styles.splashTitle}>{t.welcome}</Text>
            <Text style={ { color: C.gray, fontSize: 13, letterSpacing: 1, marginBottom: 28 }}>{t.slogan}</Text>
          </View>
          <View style={styles.roleRow}>
            {['passenger', 'driver'].map(r => (
              <TouchableOpacity key={r} onPress={()=>dispatch( { type: 'SET_ROLE', p: r })}
                style={[styles.roleBtn, state.role === r && styles.activeRole]}>
                <Text style={ { fontSize: 22, marginBottom: 4 }}>{r === 'passenger'?'🧑': '🏍️'}</Text>
                <Text style={[styles.roleTxt, state.role === r && { color: C.gold }]}>{r === 'passenger'?t.pax: t.driver}</Text>
              </TouchableOpacity>
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
          <TouchableOpacity style={styles.mainBtn} onPress={handleAuth} disabled={authLoading}>
            {authLoading?<ActivityIndicator color={C.black} />: <Text style={styles.mainBtnTxt}>{authMode === 'signin'?t.signIn.toUpperCase(): t.signUp.toUpperCase()}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={()=> { setAuthMode(authMode === 'signin'?'signup': 'signin'); setPhone(''); setPassword(''); setConfirmPass(''); setNameVal(''); }} style={ { marginTop: 24 }}>
            <Text style={ { color: C.gold, textAlign: 'center', fontSize: 14 }}>{authMode === 'signin'?t.newAcc: t.hasAcc}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );

    // ── MAIN APP ─────────────────────────────
    const AT = state.activeTrip;
    const isCompletionRequested = AT?.status === 'completion_requested';
    const isAwaitingDriverConfirm = AT?.status === 'awaiting_driver_confirm';

    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={C.black} translucent={false} />
        <MapComponent myLoc={state.myLocation} targetLoc={targetLocation} onLongPress={(coords) => {
          // Long press on map sets it as destination
          if (state.role === 'passenger' && !AT) {
            const label = `📌 ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
            setDestCoords(coords);
            setTargetLocation(coords);
            setDestName(label);
            setSearchQuery(label);
            setSuggestions([]);
            showBanner('📌 MotoLink', t.notif_mapPin, 'location');
          }
        }} />
        <NotificationBanner data={state.banner} onHide={()=>dispatch( { type: 'HIDE_BANNER' })} />

        {/* Rating modal */}
        <RatingModal visible={ratingModal} trip={tripToRate} role={state.role} t={t}
          onSubmit={submitRating} onSkip={()=> { setRatingModal(false); setTripToRate(null); }} />

        {/* Payment modal — passenger pays driver */}
        <PaymentModal visible={paymentModal} trip={AT} driverProfile={driverPayProfile} t={t}
          onPaid={passengerConfirmedPayment} onCash={()=> { setPaymentModal(false); passengerConfirmedPayment('cash'); }} onClose={()=>setPaymentModal(false)} />

        {/* Driver payment setup modal */}
        <PaymentSetupModal visible={paySetupModal} profile={state.profile} t={t}
          onSave={savePaymentInfo} onClose={()=>setPaySetupModal(false)} />

        {/* Profile modal */}
        <Modal visible={profileModal} animationType="fade" transparent>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios'?'padding': 'height'} style={ { flex: 1 }}>
            <View style={styles.modalBg}>
              <ScrollView contentContainerStyle={styles.glassModal} keyboardShouldPersistTaps="handled">
                <View style={ { alignItems: 'center', marginBottom: 16 }}>
                  <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
                  <Text style={[styles.splashTitle, { fontSize: 20, marginBottom: 4 }]}>{t.settings}</Text>
                </View>
                <View style={ { alignItems: 'center', marginBottom: 20 }}>
                  <View style={[styles.avatarWrap, { width: 72, height: 72, borderRadius: 36 }]}>
                    <Text style={[styles.avatarTxt, { fontSize: 26 }]}>{state.profile?.name?.substring(0, 2).toUpperCase() || 'ME'}</Text>
                  </View>
                  <View style={ { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 }}>
                    <StarRow rating={state.profile?.rating || 5.0} size={18} />
                    <Text style={ { color: C.gold, fontWeight: '800', fontSize: 15 }}>{(state.profile?.rating || 5.0).toFixed(1)}</Text>
                    <Text style={ { color: C.gray, fontSize: 11 }}>({state.profile?.total_ratings || 0})</Text>
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
                    {/* Driver payment info summary */}
                    <View style={styles.driverPayInfo}>
                      <Text style={styles.driverPayLabel}>{t.paymentSetup}</Text>
                      {state.profile?.momo_name?(
                        <View style={ { marginTop: 6 }}>
                          <Text style={ { color: C.white, fontWeight: '700', fontSize: 13 }}>{state.profile.momo_name}</Text>
                          <Text style={ { color: C.gray, fontSize: 12, marginTop: 2 }}>
                            {state.profile.momo_type === 'merchant'?`${t.merchantCode}: ${state.profile.momo_merchant_code}`: `${t.momoNumber}: ${state.profile.momo_number}`}
                          </Text>
                        </View>
                      ): (
                        <Text style={ { color: C.orange, fontSize: 12, marginTop: 6 }}>⚠️ {t.noPaymentWarning}</Text>
                      )}
                      <TouchableOpacity style={[styles.outlineBtn, { marginTop: 10 }]} onPress={()=>setPaySetupModal(true)}>
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
                        const msg = encodeURIComponent(
                          `🛵 *Join MotoLink!*\n\nUse my referral code: *${state.profile?.referral_code || ''}*\n\nDownload MotoLink — The Future of Ride-Hailing in Rwanda.\n\n_Powered by MotoLink_`
                        );
                        Linking.openURL(`whatsapp://send?text=${msg}`).catch(()=> {});
                      }}>
                      <Text style={styles.referralShareTxt}>📲 {t.referralShare}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={ { color: C.gray, fontSize: 11, marginTop: 6, lineHeight: 16 }}>{t.referralInfo}</Text>
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
                  style={[styles.outlineBtn, { marginTop: 12 }]}>
                  <Text style={styles.outlineBtnTxt}>🚪 {t.signOut}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDeleteAccount} style={[styles.outlineBtn, { borderColor: C.red, marginTop: 10 }]}>
                  <Text style={[styles.outlineBtnTxt, { color: C.red }]}>🗑️ {t.deleteAcc}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={()=>setProfileModal(false)} style={ { marginTop: 18 }}>
                  <Text style={ { color: C.gray, textAlign: 'center', fontSize: 13 }}>{t.close}</Text>
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
              <View style={ { flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
                <Text style={[styles.historyTitle, { flex: 1 }]}>{t.leaderboard}</Text>
                <TouchableOpacity onPress={()=>setShowLeaderboard(false)} style={styles.closeBtn}>
                  <Text style={ { color: C.gray, fontSize: 18 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={ { color: C.gray, fontSize: 12, marginBottom: 14 }}>{t.topDrivers}</Text>
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
            <View style={[styles.glassModal, { alignItems: 'center' }]}>
              <Text style={ { fontSize: 48, marginBottom: 8 }}>🚨</Text>
              <Text style={[styles.splashTitle, { fontSize: 22, color: C.red, letterSpacing: 2 }]}>{t.sosTitle}</Text>
              <Text style={ { color: C.gray, fontSize: 13, textAlign: 'center', marginTop: 12, marginBottom: 24, lineHeight: 20 }}>
                {t.sosConfirm}
              </Text>
              {/* Show emergency contact if set */}
              {state.profile?.emergency_name && (
                <View style={[styles.sosContactBox, { width: '100%', marginBottom: 16 }]}>
                  <Text style={styles.sosContactLabel}>📞 {t.emergencyContact}</Text>
                  <Text style={ { color: C.white, fontWeight: '700', fontSize: 14, marginTop: 4 }}>{state.profile.emergency_name}</Text>
                  <Text style={ { color: C.gray, fontSize: 12 }}>{state.profile.emergency_phone}</Text>
                </View>
              )}
              <TouchableOpacity style={[styles.mainBtn, { width: '100%', backgroundColor: C.red }]} onPress={triggerSOS}>
                <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.sosSend}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>setSosModal(false)} style={ { marginTop: 16 }}>
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
            dispatch( { type: 'SET_ACTIVE_TRIP', p: trip });
            requestCompletion();
          }}
          onCancelTrip={(id, otherId)=>cancelTrip(id, otherId)}
          onConfirmPayment={async(trip)=> {
            dispatch( { type: 'SET_ACTIVE_TRIP', p: trip });
            if (state.role === 'passenger') await passengerConfirmComplete();
            else await driverConfirmPayment();
          }}
          />

        {/* Header */}
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={styles.headerRow}>
            {state.role === 'passenger'?(
              <MorphingMenu isOpen={state.menuOpen} onPress={()=>dispatch( { type: 'TOGGLE_MENU' })} />
            ): (
              <View style={styles.driverHeader}>
                <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
                <Text style={styles.driverDashTxt}>{t.driverDash}</Text>
              </View>
            )}
            {/* History button — visible for both roles */}
            <TouchableOpacity
              style={[styles.historyBtn,
                { marginLeft: state.role === 'driver' ? 'auto': 6 }]}
              onPress={()=>setHistoryModal(true)}>
              <Text style={ { fontSize: 18 }}>🕐</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.avatarWrap,
              { marginLeft: 8 }]} onPress={()=>setProfileModal(true)}>
              {state.profile?.avatar?<Image source={ { uri: state.profile.avatar }} style={styles.avatarImg} />: <Text style={styles.avatarTxt}>{state.profile?.name?.substring(0, 2).toUpperCase() || 'ME'}</Text>}
            </TouchableOpacity>
            {state.role === 'passenger'&&!state.menuOpen&&!AT && (
              <View style={ { flex: 1, marginLeft: 10, position: 'relative' }}>
                <View style={styles.searchContainer}>
                  <TextInput style={styles.searchInput} placeholder={t.searchWhere} placeholderTextColor="#666"
                    value={searchQuery} onChangeText={handleSearchInput} onSubmitEditing={triggerSearch}
                    returnKeyType="search" autoCorrect={false} autoCapitalize="none" />
                  <TouchableOpacity onPress={triggerSearch} style={styles.searchIconBtn} activeOpacity={0.75}>
                    {searchLoading?<ActivityIndicator size="small" color={C.black} />: <Text style={ { fontSize: 16 }}>🔍</Text>}
                  </TouchableOpacity>
                </View>
                {suggestions.length > 0 && (
                  <ScrollView
                    style={styles.suggestionBox}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={true}
                    nestedScrollEnabled={true}
                  >
                    {suggestions.map((item, i) => {
                      const label = buildLabel(item);
                      const a = item.address || {};
                      const sub = item._isManual
                        ? (t.notif_locGranted?.includes('map') ? '📌 Tap to use this as your destination' : '📌 Tap to use as destination')
                        : [a.suburb, a.city_district, a.city || a.town || a.county].filter(Boolean).join(', ');
                      return (
                        <TouchableOpacity key={item.place_id || i} style={[styles.suggestionItem, item._isManual && { borderColor: C.gold + '40', borderWidth: 1, borderRadius: 8, margin: 4 }]} onPress={() => selectDestination(item)}>
                          <Text style={[styles.suggestionTitle, item._isManual && { color: C.orange }]} numberOfLines={1}>
                            {item._isManual ? '🗺️ ' : '📍 '}{label}
                          </Text>
                          {sub ? <Text style={styles.suggestionSub} numberOfLines={1}>{sub}</Text> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            )}
          </View>
        </SafeAreaView>

        {/* Passenger trip panel */}
        <Animated.View style={[styles.statusPanel,
          { transform: [{ translateY: menuAnim }]}]}>
          <View style={styles.panelHeader}>
            <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
            <Text style={styles.panelTitle}>{t.myRequests}</Text>
          </View>
          <ScrollView style={ { maxHeight: 340 }} showsVerticalScrollIndicator={false}>
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
                      {trip.driver_phone && (
                        <TouchableOpacity onPress={()=>Linking.openURL(`tel:${trip.driver_phone}`)}>
                          <Text style={styles.callBtn}>{t.callDriver}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
                <TouchableOpacity onPress={()=>cancelTrip(trip.id, trip.driver_id || null)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnTxt}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </Animated.View>

        {/* Bottom Sheet */}
        <SafeAreaView edges={['bottom']} style={styles.bottomSheet}>
          {state.role === 'passenger'?(
            AT?(
              <View>
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
                <View style={styles.driverContactRow}>
                  <View>
                    <Text style={ { color: C.gray, fontSize: 11 }}>{t.driver}</Text>
                    <Text style={ { color: C.white, fontWeight: '700', fontSize: 15 }}>{AT.driver_name || 'Driver'}</Text>
                    <DriverRatingBadge driverId={AT.driver_id} />
                  </View>
                  <TouchableOpacity onPress={()=>Linking.openURL(`tel:${AT.driver_phone}`)} style={styles.callPill}>
                    <Text style={styles.callPillTxt}>{t.callDriver}</Text>
                  </TouchableOpacity>
                </View>
                {/* Passenger completion flow */}
                {AT.status === 'completion_requested' && (
                  <TouchableOpacity style={[styles.mainBtn, { backgroundColor: C.green, marginTop: 10 }]} onPress={passengerConfirmComplete}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>✅ {t.confirmComplete}</Text>
                  </TouchableOpacity>
                )}
                {AT.status === 'awaiting_driver_confirm' && (
                  <View style={[styles.statusPill, { backgroundColor: C.greenDim, alignSelf: 'stretch', alignItems: 'center', marginTop: 10 }]}>
                    <Text style={[styles.statusPillTxt, { color: C.green }]}>💰 {t.awaitingDriverConfirm}</Text>
                  </View>
                )}
                {AT.status === 'accepted' && (
                  <TouchableOpacity style={[styles.mainBtn, { backgroundColor: C.red, marginTop: 10 }]} onPress={()=>cancelTrip(AT.id, AT.driver_id)}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.cancelTrip}</Text>
                  </TouchableOpacity>
                )}
              </View>
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
                      {state.myLocation?'📍 Current Location': t.loading}
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
                      <Text style={{ color: C.gold, fontSize: 13, fontWeight: '800', marginBottom: 12, letterSpacing: 0.5 }}>
                        📅 {t.scheduleDate}
                      </Text>

                      {/* Day selector */}
                      <Text style={{ color: C.gray, fontSize: 11, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>DAY</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                        {Array.from({ length: MAX_SCHEDULE_DAYS }, (_, i) => {
                          const d = new Date();
                          d.setDate(d.getDate() + i);
                          d.setHours(0, 0, 0, 0);
                          const sel = scheduledFor && scheduledFor.toDateString() === d.toDateString();
                          return (
                            <TouchableOpacity key={i}
                              style={[styles.timeSlot, { minWidth: 60, marginRight: 8 }, sel && styles.timeSlotActive]}
                              onPress={() => {
                                const updated = scheduledFor ? new Date(scheduledFor) : new Date();
                                updated.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                                if (updated <= new Date()) updated.setHours(new Date().getHours() + 1, 0, 0, 0);
                                setScheduledFor(updated);
                              }}>
                              <Text style={[styles.timeSlotDay, sel && { color: C.gold }]}>
                                {i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString([], { weekday: 'short' })}
                              </Text>
                              <Text style={[styles.timeSlotTime, { fontSize: 15 }, sel && { color: C.gold }]}>
                                {d.getDate()}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      {/* Hour selector */}
                      <Text style={{ color: C.gray, fontSize: 11, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>HOUR</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                        {Array.from({ length: 24 }, (_, h) => {
                          const sel = scheduledFor && scheduledFor.getHours() === h;
                          const isPast = scheduledFor &&
                            scheduledFor.toDateString() === new Date().toDateString() &&
                            h <= new Date().getHours();
                          return (
                            <TouchableOpacity key={h}
                              style={[styles.timeSlot, { minWidth: 52, marginRight: 8, opacity: isPast ? 0.35 : 1 }, sel && styles.timeSlotActive]}
                              disabled={isPast}
                              onPress={() => {
                                const updated = scheduledFor ? new Date(scheduledFor) : new Date();
                                updated.setHours(h, scheduledFor?.getMinutes() || 0, 0, 0);
                                setScheduledFor(updated);
                              }}>
                              <Text style={[styles.timeSlotDay, sel && { color: C.gold }]}>hr</Text>
                              <Text style={[styles.timeSlotTime, sel && { color: C.gold }]}>
                                {h.toString().padStart(2, '0')}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      {/* Minute selector */}
                      <Text style={{ color: C.gray, fontSize: 11, fontWeight: '600', marginBottom: 6, letterSpacing: 0.5 }}>MINUTE</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => {
                          const sel = scheduledFor && scheduledFor.getMinutes() === m;
                          return (
                            <TouchableOpacity key={m}
                              style={[styles.timeSlot, { minWidth: 52, marginRight: 8 }, sel && styles.timeSlotActive]}
                              onPress={() => {
                                const updated = scheduledFor ? new Date(scheduledFor) : new Date();
                                updated.setMinutes(m, 0, 0);
                                setScheduledFor(updated);
                              }}>
                              <Text style={[styles.timeSlotDay, sel && { color: C.gold }]}>min</Text>
                              <Text style={[styles.timeSlotTime, sel && { color: C.gold }]}>
                                :{m.toString().padStart(2, '0')}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>

                      {/* Confirmation display */}
                      {scheduledFor && (
                        <View style={{ backgroundColor: C.goldDim, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.gold, flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ fontSize: 18, marginRight: 8 }}>📅</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.gold, fontWeight: '900', fontSize: 13 }}>
                              {scheduledFor.toLocaleDateString([], { weekday: 'long', day: '2-digit', month: 'short' })}
                            </Text>
                            <Text style={{ color: C.white, fontWeight: '700', fontSize: 16, marginTop: 2 }}>
                              {scheduledFor.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                          </View>
                          <TouchableOpacity onPress={() => setScheduledFor(null)} style={{ padding: 4 }}>
                            <Text style={{ color: C.gray, fontSize: 18 }}>✕</Text>
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
                          getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude),
                          surgeMultiplier
                        ))}
                      </Text>
                      {surgeActive && (
                        <Text style={ { color: C.grayDark, fontSize: 11, textDecorationLine: 'line-through' }}>
                          {fmtFRW(calcFare(getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude)))} base
                        </Text>
                      )}
                    </View>
                    <View style={ { alignItems: 'flex-end' }}>
                      <Text style={styles.fareDist}>
                        {getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude)} km
                      </Text>
                      {surgeActive && <View style={styles.surgePill}><Text style={styles.surgePillTxt}>⚡ 1.5×</Text></View>}
                    </View>
                  </View>

                  <View style={styles.payToggleRow}>
                    <Text style={ { color: C.gray, fontSize: 12, marginRight: 6 }}>{t.payWith}:</Text>
                    {['cash', 'momo'].map(m => (
                      <TouchableOpacity key={m} onPress={()=>setPaymentMethod(m)}
                        style={[styles.payToggleBtn,
                          paymentMethod === m && styles.payToggleBtnActive]}>
                        <Text style={[styles.payToggleTxt,
                          paymentMethod === m && { color: C.gold }]}>
                          {m === 'cash'?t.cash: t.momoTap}
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
                        {fmtFRW(calcFareWithSurge(getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude), surgeMultiplier))}
                      </Text>
                      <Text style={[styles.fareAmt, { color: C.green }]}>
                        {fmtFRW(Math.max(0, calcFareWithSurge(getDistance(state.myLocation?.latitude, state.myLocation?.longitude, destCoords.latitude, destCoords.longitude), surgeMultiplier) - promoData.discount))}
                      </Text>
                    </View>
                  )}

                  <TouchableOpacity style={styles.mainBtn} onPress={requestRide} disabled={rideLoading}>
                    {rideLoading
                    ?<ActivityIndicator color={C.black} />: <Text style={styles.mainBtnTxt}>🛵 {t.req?.toUpperCase() || 'REQUEST MOTO'}</Text>
                    }
                  </TouchableOpacity>
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
              <ScrollView style={ { maxHeight: 340 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.jobTitle}>{t.activeJob}</Text>
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
                  <View style={[styles.statusPill, { backgroundColor: AT.payment_method === 'momo'?C.goldDim: C.glassLight, marginTop: 0 }]}>
                    <Text style={[styles.statusPillTxt, { color: AT.payment_method === 'momo'?C.gold: C.gray }]}>
                      {AT.payment_method === 'momo'?t.momoTap: t.cash}
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
                  <TouchableOpacity onPress={()=>Linking.openURL(`tel:${AT.passenger_phone}`)} style={styles.callPill}>
                    <Text style={styles.callPillTxt}>{t.callPassenger}</Text>
                  </TouchableOpacity>
                </View>
                {/* Driver completion flow */}
                {AT.status === 'accepted' && AT.trip_type !== 'delivery' && (
                  <View style={ { flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <TouchableOpacity style={[styles.mainBtn, { flex: 1, backgroundColor: C.red }]} onPress={()=>cancelTrip(AT.id, AT.passenger_id)}>
                      <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.cancelTrip}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.mainBtn, { flex: 1, backgroundColor: C.blue }]} onPress={requestCompletion}>
                      <Text style={[styles.mainBtnTxt, { color: C.white, fontSize: 12 }]}>{t.arrivedBtn}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {/* Multi-stop: Mark stop reached */}
                {AT.status === 'accepted' && AT.stops && JSON.parse(AT.stops).length > (AT.current_stop_index || 0) && (
                  <TouchableOpacity style={[styles.mainBtn, { backgroundColor: C.blue, marginTop: 10 }]} onPress={markStopReached}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.markReached}</Text>
                  </TouchableOpacity>
                )}
                {/* Delivery: Picked up / Delivered */}
                {AT.trip_type === 'delivery' && AT.status === 'accepted' && (
                  <View style={ { gap: 8, marginTop: 12 }}>
                    <TouchableOpacity style={[styles.mainBtn, { backgroundColor: C.orange }]} onPress={()=>updateDeliveryStatus('picked_up')}>
                      <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.pickedUp}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {AT.trip_type === 'delivery' && AT.status === 'picked_up' && (
                  <TouchableOpacity style={[styles.mainBtn, { backgroundColor: C.green, marginTop: 10 }]} onPress={()=>updateDeliveryStatus('delivered')}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>{t.delivered}</Text>
                  </TouchableOpacity>
                )}
                {AT.status === 'completion_requested' && (
                  <View style={[styles.statusPill, { backgroundColor: C.blueDim, alignSelf: 'stretch', alignItems: 'center', marginTop: 12 }]}>
                    <Text style={[styles.statusPillTxt, { color: C.blue }]}>⏳ {t.awaitingPayment}</Text>
                  </View>
                )}
                {AT.status === 'awaiting_driver_confirm' && (
                  <TouchableOpacity style={[styles.mainBtn, { backgroundColor: C.green, marginTop: 12 }]} onPress={driverConfirmPayment}>
                    <Text style={[styles.mainBtnTxt, { color: C.white }]}>💰 {t.driverConfirm}</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            ): (
              <ScrollView style={ { maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                <View style={ { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={styles.jobTitle}>📋 {t.availJobs} ({state.availableTrips.length})</Text>
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
                {state.availableTrips.length === 0 && <Text style={styles.hintText}>{t.scanJobs}</Text>}
                {state.availableTrips.map(j => (
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
                          <View style={[styles.statusPill, { backgroundColor: j.payment_method === 'momo'?C.goldDim: C.glassLight, marginTop: 0, paddingVertical: 2 }]}>
                            <Text style={[styles.statusPillTxt, { color: j.payment_method === 'momo'?C.gold: C.gray }]}>{j.payment_method === 'momo'?t.momoTap: t.cash}</Text>
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
                      <TouchableOpacity onPress={()=>acceptTrip(j)} style={styles.acceptBtn}>
                        <Text style={styles.acceptBtnTxt}>{t.signIn === 'Sign In'?'ACCEPT': t.signIn === 'Injira'?'EMEZA': 'ACCEPTER'}</Text>
                      </TouchableOpacity>
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
            )
          )}
        </SafeAreaView>
      </View>
    );
  }

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
      flex: 1, backgroundColor: C.black, overflow: 'visible',
    },
    map: {
      flex: 1, backgroundColor: C.black
    },
    authView: {
      flexGrow: 1, backgroundColor: C.black, justifyContent: 'center', padding: 28, paddingTop: 60
    },
    splashContainer: {
      flex: 1, backgroundColor: C.black, justifyContent: 'center', alignItems: 'center'
    },
    splashLogoRing: {
      width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: C.gold, backgroundColor: C.goldDim, justifyContent: 'center', alignItems: 'center', marginBottom: 12
    },
    splashLogoTxt: {
      color: C.gold, fontWeight: '900', fontSize: 22, letterSpacing: 2
    },
    splashLogoRingSmall: {
      width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: C.gold, backgroundColor: C.goldDim, justifyContent: 'center', alignItems: 'center', marginRight: 8
    },
    splashLogoTxtSmall: {
      color: C.gold, fontWeight: '900', fontSize: 11, letterSpacing: 1
    },
    splashTitle: {
      color: C.gold, fontSize: 30, fontWeight: '900', letterSpacing: 5, textAlign: 'center', marginBottom: 6
    },
    splashSlogan: {
      color: C.gray, fontSize: 13, letterSpacing: 2, fontStyle: 'italic'
    },
    roleRow: {
      flexDirection: 'row', gap: 12, marginBottom: 28
    },
    roleBtn: {
      flex: 1, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: C.borderFaint, alignItems: 'center', backgroundColor: C.card
    },
    activeRole: {
      borderColor: C.gold, backgroundColor: C.goldDim
    },
    roleTxt: {
      color: C.gray, fontWeight: '700', fontSize: 13, letterSpacing: 0.5
    },
    inputWrap: {
      marginBottom: 14
    },
    inputLabel: {
      color: C.gray, fontSize: 11, letterSpacing: 1.2, marginBottom: 6, marginLeft: 2, textTransform: 'uppercase'
    },
    input: {
      backgroundColor: C.card, color: C.white, padding: 16, borderRadius: 14, fontSize: 15, borderWidth: 1, borderColor: C.borderFaint
    },
    passRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8
    },
    eyeBtn: {
      width: 48, height: 52, backgroundColor: C.card, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.borderFaint
    },
    eyeIcon: {
      fontSize: 20
    },
    mainBtn: {
      backgroundColor: C.gold, padding: 18, borderRadius: 16, alignItems: 'center', shadowColor: C.gold, shadowOffset: {
        width: 0, height: 6
      }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8
    },
    mainBtnTxt: {
      color: C.black, fontWeight: '900', fontSize: 15, letterSpacing: 1.5
    },
    outlineBtn: {
      padding: 16, borderRadius: 16, alignItems: 'center', borderWidth: 1.5, borderColor: C.border
    },
    outlineBtnTxt: {
      color: C.gold, fontWeight: '700', fontSize: 14
    },
    langBtn: {
      backgroundColor: C.card, padding: 18, borderRadius: 16, marginVertical: 7, borderWidth: 1, borderColor: C.border
    },
    langTxt: {
      color: C.white, textAlign: 'center', fontWeight: '700', fontSize: 15, letterSpacing: 0.5
    },
    header: {
      position: 'absolute', top: 0, width: '100%', zIndex: 100, paddingHorizontal: 12, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 6 : 8, paddingBottom: 8,
    },
    headerRow: {
      flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap',
    },
    hamburgerWrap: {
      width: 46, height: 46, backgroundColor: C.glass, borderRadius: 23, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border
    },
    bar: {
      width: 20, height: 2, backgroundColor: C.gold, marginVertical: 2, borderRadius: 2
    },
    driverHeader: {
      flexDirection: 'row', alignItems: 'center'
    },
    driverDashTxt: {
      color: C.gold, fontWeight: '900', fontSize: 15, letterSpacing: 2
    },
    avatarWrap: {
      width: 42, height: 42, borderRadius: 21, backgroundColor: C.card, borderWidth: 2, borderColor: C.gold, justifyContent: 'center', alignItems: 'center', overflow: 'hidden'
    },
    avatarTxt: {
      color: C.white, fontWeight: '900', fontSize: 13
    },
    avatarImg: {
      width: '100%', height: '100%'
    },
    searchContainer: {
      flexDirection: 'row', backgroundColor: C.white, borderRadius: 26, height: 46, alignItems: 'center', elevation: 6
    },
    searchInput: {
      flex: 1, paddingHorizontal: 16, color: '#111', fontWeight: '500', fontSize: 13
    },
    searchIconBtn: {
      width: 38, height: 38, borderRadius: 19, backgroundColor: C.gold, justifyContent: 'center', alignItems: 'center', marginRight: 4
    },
    suggestionBox: {
      position: 'absolute', top: 52, left: 0, right: 0, zIndex: 500,
      backgroundColor: C.card, borderRadius: 16, padding: 6, borderWidth: 1, borderColor: C.border, elevation: 10, maxHeight: 240,
    },
    suggestionItem: {
      paddingVertical: 11, paddingHorizontal: 12, borderBottomColor: C.borderFaint, borderBottomWidth: 1,
    },
    suggestionTitle: {
      color: C.gold, fontSize: 13, fontWeight: '700'
    },
    suggestionSub: {
      color: C.gray, fontSize: 11, marginTop: 2
    },
    notifyBanner: {
      position: 'absolute', top: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 52,
      left: 10, right: 10, zIndex: 9999,
      backgroundColor: C.card,
      borderRadius: 20, flexDirection: 'row', alignItems: 'center',
      overflow: 'hidden', borderWidth: 1.5, borderColor: C.border,
      elevation: 40,
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.5, shadowRadius: 20,
      paddingRight: 10, minHeight: 72,
    },
    notifyAccent: {
      width: 4, alignSelf: 'stretch',
    },
    notifyLogoWrap: {
      width: 40, height: 40, borderRadius: 20,
      borderWidth: 1.5, justifyContent: 'center', alignItems: 'center',
      marginLeft: 10, marginVertical: 12,
    },
    notifyLogoTxt: {
      fontWeight: '900', fontSize: 11, letterSpacing: 1,
    },
    notifyContent: {
      flex: 1, paddingLeft: 10, paddingVertical: 10,
    },
    notifyTitle: {
      color: C.white, fontWeight: '900', fontSize: 13, letterSpacing: 0.4,
    },
    notifyBody: {
      color: C.gray, fontSize: 11, marginTop: 3, lineHeight: 15,
    },
    notifyIcon: {
      fontSize: 22, marginLeft: 4,
    },
    notifyProgressTrack: {
      position: 'absolute', bottom: 0, left: 0, right: 0, height: 2.5,
      backgroundColor: 'rgba(255,255,255,0.06)',
    },
    notifyProgressBar: {
      height: 2.5, borderRadius: 2,
    },
    notifyDragHandle: {
      position: 'absolute', top: 5, left: '50%', marginLeft: -16,
      width: 32, height: 3, borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    modalBg: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', padding: 20
    },
    glassModal: {
      backgroundColor: C.card, padding: 22, borderRadius: 24, borderWidth: 1, borderColor: C.border
    },
    rateTitle: {
      color: C.gold, fontSize: 22, fontWeight: '900', letterSpacing: 2, marginTop: 12
    },
    rateSub: {
      color: C.gray, fontSize: 14, marginTop: 4, marginBottom: 4
    },
    rateTripSummary: {
      backgroundColor: C.glassLight, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.borderFaint, width: '100%', marginBottom: 16
    },
    rateSummaryTxt: {
      color: C.gray, fontSize: 12
    },
    starsRow: {
      flexDirection: 'row', gap: 6, marginVertical: 14
    },
    rateStar: {
      fontSize: 38
    },
    rateLabel: {
      color: C.gray, fontSize: 14, marginBottom: 14, letterSpacing: 0.5
    },
    reviewInput: {
      backgroundColor: C.card2, color: C.white, padding: 12, borderRadius: 14, fontSize: 13, borderWidth: 1, borderColor: C.borderFaint, width: '100%', minHeight: 72, textAlignVertical: 'top', marginBottom: 16
    },
    ratingBadge: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: C.goldDim, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: C.border
    },
    ratingBadgeTxt: {
      color: C.gold, fontWeight: '900', fontSize: 11
    },
    statusPanel: {
      position: 'absolute',
      top: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 80 : 105,
      left: 14, right: 14, backgroundColor: C.glass, borderRadius: 22,
      padding: 16, zIndex: 90, borderWidth: 1, borderColor: C.border, elevation: 14,
      maxHeight: height * 0.38,
    },
    panelHeader: {
      flexDirection: 'row', alignItems: 'center', marginBottom: 14
    },
    panelTitle: {
      color: C.gold, fontSize: 16, fontWeight: '900', letterSpacing: 1, flex: 1
    },
    routeBlock: {
      flexDirection: 'row', alignItems: 'center', gap: 8
    },
    routeDot: {
      width: 8, height: 8, borderRadius: 4, backgroundColor: C.gold, flexShrink: 0
    },
    routeLine_: {
      width: 1, height: 12, backgroundColor: C.border, marginLeft: 3.5, marginVertical: 2
    },
    tripCard: {
      backgroundColor: C.glassLight, padding: 12, borderRadius: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderColor: C.borderFaint
    },
    tripDest: {
      color: C.white, fontWeight: '700', fontSize: 13, flex: 1
    },
    timestampRow: {
      flexDirection: 'column', gap: 2, marginTop: 6, marginBottom: 4
    },
    timestampTxt: {
      color: C.grayDark, fontSize: 11
    },
    statusPill: {
      alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginTop: 8
    },
    statusPillTxt: {
      fontSize: 11, fontWeight: '900', letterSpacing: 0.5
    },
    driverInfoBox: {
      marginTop: 8, padding: 10, backgroundColor: 'rgba(212,175,55,0.06)', borderRadius: 12, borderWidth: 1, borderColor: C.border
    },
    driverInfoName: {
      color: C.white, fontWeight: '700', fontSize: 13
    },
    driverInfoDist: {
      color: C.gray, fontSize: 11, marginTop: 3
    },
    callBtn: {
      color: C.gold, fontWeight: '700', marginTop: 6, fontSize: 13
    },
    cancelBtn: {
      width: 30, height: 30, borderRadius: 15, backgroundColor: C.redDim, justifyContent: 'center', alignItems: 'center', marginLeft: 8, marginTop: 2
    },
    cancelBtnTxt: {
      color: C.red, fontWeight: '900', fontSize: 13
    },
    emptyText: {
      color: C.grayDark, textAlign: 'center', padding: 20, fontStyle: 'italic'
    },
    bottomSheet: {
      position: 'absolute', bottom: 0, width: '100%', backgroundColor: C.card,
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 20,
      borderTopLeftRadius: 28, borderTopRightRadius: 28, elevation: 20,
      borderTopWidth: 1, borderColor: C.border,
      maxHeight: height * 0.52,
    },
    fareRow: {
      flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 12
    },
    fareAmt: {
      color: C.gold, fontSize: 24, fontWeight: '900'
    },
    fareDist: {
      color: C.gray, fontSize: 13
    },
    payToggleRow: {
      flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 6, flexWrap: 'wrap'
    },
    payToggleBtn: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.borderFaint, backgroundColor: C.card2
    },
    payToggleBtnActive: {
      borderColor: C.gold, backgroundColor: C.goldDim
    },
    payToggleTxt: {
      color: C.gray, fontWeight: '700', fontSize: 12
    },
    hintText: {
      color: C.grayDark, textAlign: 'center', fontSize: 14, fontStyle: 'italic'
    },
    jobTitle: {
      color: C.gold, fontSize: 15, fontWeight: '900', letterSpacing: 0.5, marginBottom: 6
    },
    jobCard: {
      backgroundColor: C.glassLight, padding: 12, borderRadius: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.borderFaint
    },
    jobPrice: {
      color: C.gold, fontWeight: '900', fontSize: 18
    },
    acceptBtn: {
      backgroundColor: C.gold, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12
    },
    acceptBtnTxt: {
      color: C.black, fontWeight: '900', fontSize: 11, letterSpacing: 0.5
    },
    driverContactRow: {
      backgroundColor: C.glassLight, padding: 12, borderRadius: 14, marginVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: C.borderFaint
    },
    callPill: {
      backgroundColor: C.goldDim, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: C.border
    },
    callPillTxt: {
      color: C.gold, fontWeight: '900', fontSize: 12
    },
    // Payment modal
    payModal: {
      backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderColor: C.border, maxHeight: height*0.85
    },
    payModalTitle: {
      color: C.gold, fontSize: 20, fontWeight: '900', letterSpacing: 1, marginTop: 10
    },
    driverPayInfo: {
      backgroundColor: C.goldDim, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16
    },
    driverPayLabel: {
      color: C.gray, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase'
    },
    payOptionBtn: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: C.card2, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: C.border, gap: 12
    },
    payOptionTitle: {
      color: C.white, fontWeight: '800', fontSize: 15
    },
    payOptionSub: {
      color: C.gray, fontSize: 12, marginTop: 2
    },
    payOptionBadge: {
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1
    },
    ussdInfoBox: {
      backgroundColor: C.card2, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 12
    },
    methodBtn: {
      flex: 1, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.borderFaint, backgroundColor: C.card2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
    },
    methodTxt: {
      color: C.gray, fontWeight: '700', fontSize: 13
    },
    // SOS Button
    sosBtn: {
      position: 'absolute', zIndex: 8888,
      width: 60, height: 60, borderRadius: 30,
      backgroundColor: C.red, justifyContent: 'center', alignItems: 'center',
      elevation: 30, shadowColor: C.red, shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.7, shadowRadius: 12,
    },
    sosPulse: {
      position: 'absolute', width: 60, height: 60, borderRadius: 30,
      backgroundColor: 'rgba(255,76,76,0.35)',
    },
    sosBtnTxt: {
      color: C.white, fontWeight: '900', fontSize: 13, letterSpacing: 1,
    },
    // SOS emergency contact box
    sosContactBox: {
      backgroundColor: 'rgba(255,76,76,0.08)', padding: 14, borderRadius: 14,
      borderWidth: 1, borderColor: 'rgba(255,76,76,0.25)', marginBottom: 14,
    },
    sosContactLabel: {
      color: C.red, fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase',
    },
    // History button in header
    historyBtn: {
      width: 42, height: 42, borderRadius: 21, backgroundColor: C.glass,
      borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center',
    },
    // Trip history screen
    historyScreen: {
      flex: 1, backgroundColor: C.black,
    },
    historyHeader: {
      backgroundColor: C.card, paddingHorizontal: 18, paddingVertical: 12,
      borderBottomWidth: 1, borderColor: C.border,
    },
    historyTitle: {
      color: C.gold, fontWeight: '900', fontSize: 18, letterSpacing: 2, flex: 1, marginLeft: 10,
    },
    historySummary: {
      flexDirection: 'row', backgroundColor: C.goldDim, margin: 16,
      borderRadius: 18, padding: 20, borderWidth: 1, borderColor: C.border,
      alignItems: 'center',
    },
    summaryValue: {
      color: C.gold, fontWeight: '900', fontSize: 22, textAlign: 'center',
    },
    summaryLabel: {
      color: C.gray, fontSize: 11, textAlign: 'center', marginTop: 4, letterSpacing: 0.5,
    },
    summarySep: {
      width: 1, height: 40, backgroundColor: C.border, marginHorizontal: 16,
    },
    // History trip cards
    historyCard: {
      backgroundColor: C.card, marginHorizontal: 16, marginBottom: 10,
      borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.borderFaint,
    },
    // Expanded receipt
    receiptExpanded: {
      marginTop: 16, paddingTop: 16,
      borderTopWidth: 1, borderColor: C.borderFaint,
    },
    receiptRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 7, borderBottomWidth: 1, borderColor: C.borderFaint,
    },
    receiptLabel: {
      color: C.gray, fontSize: 12, flex: 1,
    },
    receiptValue: {
      color: C.white, fontSize: 12, fontWeight: '600', textAlign: 'right', flex: 1,
    },
    receiptShareBtn: {
      flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5,
      alignItems: 'center', justifyContent: 'center',
    },
    receiptShareTxt: {
      fontWeight: '800', fontSize: 12, letterSpacing: 0.5,
    },
    // Load more
    loadMoreBtn: {
      marginHorizontal: 16, marginBottom: 10, padding: 16, borderRadius: 14,
      borderWidth: 1.5, borderColor: C.border, alignItems: 'center',
      backgroundColor: C.goldDim,
    },
    loadMoreTxt: {
      color: C.gold, fontWeight: '800', fontSize: 14, letterSpacing: 0.5,
    },
    // Earnings dashboard
    earningsBox: {
      backgroundColor: C.card2, borderRadius: 16, padding: 16,
      marginTop: 16, borderWidth: 1, borderColor: C.border,
    },
    earningsHeader: {
      marginBottom: 12,
    },
    earningsSectionTitle: {
      color: C.gold, fontWeight: '900', fontSize: 15, letterSpacing: 0.5,
    },
    earningsTabs: {
      flexDirection: 'row', marginBottom: 14,
    },
    earningsTab: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
      borderWidth: 1, borderColor: C.borderFaint, backgroundColor: C.card,
      marginRight: 8,
    },
    earningsTabActive: {
      borderColor: C.gold, backgroundColor: C.goldDim,
    },
    earningsTabTxt: {
      color: C.gray, fontWeight: '700', fontSize: 12,
    },
    earningsStatsRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: C.black, borderRadius: 14, padding: 16, marginBottom: 12,
    },
    earningsStat: {
      flex: 1, alignItems: 'center',
    },
    earningsStatVal: {
      color: C.gold, fontWeight: '900', fontSize: 15, textAlign: 'center',
    },
    earningsStatLbl: {
      color: C.gray, fontSize: 10, marginTop: 4, textAlign: 'center',
    },
    earningsStatSep: {
      width: 1, height: 36, backgroundColor: C.border,
    },
    earningsPeakRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: C.goldDim, borderRadius: 12, padding: 12,
      borderWidth: 1, borderColor: C.border, marginBottom: 10,
    },
    earningsPeakLabel: {
      color: C.gold, fontWeight: '700', fontSize: 12,
    },
    earningsPeakVal: {
      color: C.white, fontWeight: '800', fontSize: 12,
    },
    earningsRecentRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 8, borderBottomWidth: 1, borderColor: C.borderFaint,
    },
    // Surge pricing
    surgeBanner: {
      backgroundColor: 'rgba(243,156,18,0.15)', borderWidth: 1,
      borderColor: 'rgba(243,156,18,0.4)', borderRadius: 12,
      padding: 10, marginTop: 10, marginBottom: 2,
    },
    surgeBannerTxt: {
      color: C.orange, fontWeight: '900', fontSize: 13, letterSpacing: 0.5,
    },
    surgeBannerSub: {
      color: C.orange, fontSize: 11, marginTop: 3, opacity: 0.8,
    },
    surgePill: {
      backgroundColor: 'rgba(243,156,18,0.2)', paddingHorizontal: 8,
      paddingVertical: 3, borderRadius: 10, borderWidth: 1,
      borderColor: 'rgba(243,156,18,0.5)', marginTop: 4,
    },
    surgePillTxt: {
      color: C.orange, fontWeight: '900', fontSize: 11,
    },
    // close button
    closeBtn: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: C.glassLight,
      justifyContent: 'center', alignItems: 'center',
    },
    // Promo code
    promoRow: {
      flexDirection: 'row', gap: 8, marginBottom: 10,
    },
    promoInput: {
      flex: 1, backgroundColor: C.card2, color: C.white, padding: 12,
      borderRadius: 12, fontSize: 13, borderWidth: 1, borderColor: C.borderFaint,
      letterSpacing: 2,
    },
    promoApplyBtn: {
      backgroundColor: C.gold, paddingHorizontal: 16, borderRadius: 12,
      justifyContent: 'center', alignItems: 'center', minWidth: 72,
    },
    promoApplyTxt: {
      color: C.black, fontWeight: '900', fontSize: 12,
    },
    promoAppliedBanner: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: C.greenDim,
      borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.green+'44',
      marginBottom: 10,
    },
    promoAppliedTxt: {
      color: C.green, fontWeight: '900', fontSize: 13, letterSpacing: 1,
    },
    finalPriceRow: {
      flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 12,
    },
    // Referral
    referralBox: {
      backgroundColor: C.goldDim, borderRadius: 16, padding: 16,
      borderWidth: 1, borderColor: C.border, marginBottom: 14, marginTop: 6,
    },
    referralLabel: {
      color: C.gold, fontWeight: '900', fontSize: 12, letterSpacing: 1,
      textTransform: 'uppercase', marginBottom: 10,
    },
    referralCodeRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
    },
    referralCodeTxt: {
      color: C.white, fontWeight: '900', fontSize: 20, letterSpacing: 4, flex: 1,
    },
    referralShareBtn: {
      backgroundColor: C.green+'22', paddingHorizontal: 12, paddingVertical: 8,
      borderRadius: 12, borderWidth: 1, borderColor: C.green+'44',
    },
    referralShareTxt: {
      color: C.green, fontWeight: '800', fontSize: 12,
    },
    referralEarnedRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: C.border,
    },
    // History tabs
    histTabRow: {
      flexDirection: 'row', marginHorizontal: 16, marginBottom: 4,
      backgroundColor: C.card2, borderRadius: 14, padding: 4,
    },
    histTab: {
      flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10,
    },
    histTabActive: {
      backgroundColor: C.goldDim,
    },
    histTabTxt: {
      color: C.gray, fontWeight: '700', fontSize: 12,
    },
    // Active mission action buttons in history
    histActionBtn: {
      flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5,
      alignItems: 'center', justifyContent: 'center',
    },
    histActionTxt: {
      fontWeight: '900', fontSize: 12, letterSpacing: 0.5,
    },
    // Offline banner
    offlineBanner: {
      position: 'absolute',
      top: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0,
      left: 0, right: 0, zIndex: 1500,
      backgroundColor: 'rgba(10,10,50,0.97)', paddingVertical: 8, paddingHorizontal: 16,
      borderBottomWidth: 1, borderColor: C.blue,
    },
    offlineBannerTxt: {
      color: C.blue, fontWeight: '700', fontSize: 12, textAlign: 'center',
    },
    offlineBannerSub: {
      color: C.gray, fontSize: 10, textAlign: 'center', marginTop: 2,
    },
    // Service mode toggle
    serviceModeRow: {
      flexDirection: 'row', gap: 8, marginBottom: 12,
    },
    serviceModeBtn: {
      flex: 1, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5,
      borderColor: C.borderFaint, backgroundColor: C.card2, alignItems: 'center',
    },
    serviceModeBtnActive: {
      borderColor: C.gold, backgroundColor: C.goldDim,
    },
    serviceModeTxt: {
      color: C.gray, fontWeight: '700', fontSize: 13,
    },
    // Delivery fields
    deliveryFieldsBox: {
      backgroundColor: C.card2, borderRadius: 14, padding: 12,
      borderWidth: 1, borderColor: C.blueDim, marginBottom: 10,
    },
    // Multi-stop
    addStopBtn: {
      borderWidth: 1.5, borderColor: C.blue, borderRadius: 12,
      paddingVertical: 8, alignItems: 'center', marginTop: 8, marginBottom: 4,
      backgroundColor: C.blueDim,
    },
    addStopTxt: {
      color: C.blue, fontWeight: '800', fontSize: 13,
    },
    // Schedule mode
    scheduleModeRow: {
      flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 4,
    },
    scheduleBtn: {
      flex: 1, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5,
      borderColor: C.borderFaint, backgroundColor: C.card2, alignItems: 'center',
    },
    scheduleBtnActive: {
      borderColor: C.gold, backgroundColor: C.goldDim,
    },
    scheduleBtnTxt: {
      color: C.gray, fontWeight: '700', fontSize: 12,
    },
    // Time slot chips
    datePickerBox: {
      backgroundColor: C.card2, borderRadius: 14, padding: 12,
      borderWidth: 1, borderColor: C.border, marginBottom: 10,
    },
    timeSlot: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
      borderWidth: 1, borderColor: C.borderFaint, backgroundColor: C.card,
      marginRight: 8, alignItems: 'center', minWidth: 72,
    },
    timeSlotActive: {
      borderColor: C.gold, backgroundColor: C.goldDim,
    },
    timeSlotDay: {
      color: C.gray, fontSize: 10, fontWeight: '600',
    },
    timeSlotTime: {
      color: C.white, fontSize: 13, fontWeight: '800', marginTop: 2,
    },
    // Leaderboard
    leaderboardBtn: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: C.goldDim,
      borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center',
    },
    leaderboardBtnTxt: {
      fontSize: 18,
    },
    leaderRow: {
      flexDirection: 'row', alignItems: 'center', padding: 12,
      backgroundColor: C.card2, borderRadius: 14, marginBottom: 8,
      borderWidth: 1, borderColor: C.borderFaint,
    },
    leaderRank: {
      fontSize: 20, width: 32, textAlign: 'center',
    },
  });