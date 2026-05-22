/**
* MOTOLINK — Admin App
* Standalone React Native app for MotoLink administrators
* Features: Driver verification, Trip overview, User management,
*           Top-up approvals, Revenue dashboard, Push notifications
*
* Usage: Create a separate Expo project and use this as App.js
* Run:   npx expo start (separate from the main MotoLink app)
*/

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useReducer
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
  RefreshControl,
  Modal,
  Image,
  Dimensions,
  StatusBar,
  Animated,
  Platform,
  FlatList
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView
} from 'react-native-safe-area-context';
import {
  supabase
} from './supabase'; // same supabase.js as main app

const {
  width,
  height
} = Dimensions.get('window');

// ══════════════════════════════════════════════
// ADMIN CONFIG
// ══════════════════════════════════════════════
const ADMIN_PIN = '24241300'; // Change this to your secure PIN
const ADMIN_ID = 'admin_001'; // Your admin identifier

// ══════════════════════════════════════════════
// DESIGN TOKENS
// ══════════════════════════════════════════════
const C = {
  black: '#0A0A0A',
  card: '#1A1A1A',
  card2: '#222222',
  gold: '#D4AF37',
  goldDim: 'rgba(212,175,55,0.15)',
  white: '#FFFFFF',
  offWhite: '#E8E8E8',
  glass: 'rgba(18,18,18,0.95)',
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
  purple: '#9B59B6',
  purpleDim: 'rgba(155,89,182,0.15)',
  gray: '#A0A0A0',
  grayDark: '#444',
};

// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════
const fmtFRW = (n) => `${(n || 0).toLocaleString()} FRW`;
const fmtNum = (n) => (n || 0).toLocaleString();
const fmtTime = (iso) => {
  if (!iso) return '—'; return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit'
  });
};
const fmtDate = (iso) => {
  if (!iso) return '—'; return new Date(iso).toLocaleDateString([], {
    day: '2-digit', month: 'short', year: 'numeric'
  });
};
const fmtDT = (iso) => {
  if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString([], {
    day: '2-digit', month: 'short'
  })+' '+d.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit'
  });
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
        to: token, title, body, data, sound: 'default', priority: 'high', color: '#D4AF37'
      }),
    });
  } catch {}
};

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
const initialState = {
  authed: false,
  tab: 'dashboard',
  // dashboard | verification | users | topups | trips | push
  stats: null,
  pendingDrivers: [],
  users: [],
  topupRequests: [],
  activeTrips: [],
  loading: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'AUTH': return {
      ...state,
      authed: true
    };
    case 'SET_TAB': return {
        ...state,
        tab: action.p
      };
    case 'SET_STATS': return {
        ...state,
        stats: action.p
      };
    case 'SET_PENDING': return {
        ...state,
        pendingDrivers: action.p
      };
    case 'SET_USERS': return {
        ...state,
        users: action.p
      };
    case 'SET_TOPUPS': return {
        ...state,
        topupRequests: action.p
      };
    case 'SET_TRIPS': return {
        ...state,
        activeTrips: action.p
      };
    case 'SET_LOADING': return {
        ...state,
        loading: action.p
      };
    default: return state;
  }
}

// ══════════════════════════════════════════════
// PIN SCREEN
// ══════════════════════════════════════════════
const PinScreen = ({
  onAuth
}) => {
  const [pin,
    setPin] = useState('');
  const [error,
    setError] = useState('');
  const [shake] = useState(new Animated.Value(0));

  const doShake = () => {
    Animated.sequence([
      Animated.timing(shake, {
        toValue: 10, duration: 50, useNativeDriver: true
      }),
      Animated.timing(shake, {
        toValue: -10, duration: 50, useNativeDriver: true
      }),
      Animated.timing(shake, {
        toValue: 10, duration: 50, useNativeDriver: true
      }),
      Animated.timing(shake, {
        toValue: 0, duration: 50, useNativeDriver: true
      }),
    ]).start();
  };

  const handlePin = (digit) => {
    const next = pin + digit;
    setPin(next);
    setError('');
    if (next.length === ADMIN_PIN.length) {
      if (next === ADMIN_PIN) {
        onAuth();
      } else {
        doShake();
        setError('Incorrect PIN');
        setTimeout(() => setPin(''), 600);
      }
    }
  };

  const dots = ADMIN_PIN.split('').map((_, i) => (
    <View key={i} style={[styles.pinDot, i < pin.length && styles.pinDotFilled]} />
  ));

  return (
    <View style={styles.pinScreen}>
      <View style={styles.splashLogoRing}><Text style={styles.splashLogoTxt}>ML</Text></View>
      <Text style={styles.pinTitle}>MOTOLINK ADMIN</Text>
      <Text style={ { color: C.gray, fontSize: 13, marginBottom: 40, letterSpacing: 1 }}>Enter Admin PIN</Text>
      <Animated.View style={[styles.pinDotsRow, { transform: [{ translateX: shake }] }]}>
        {dots}
      </Animated.View>
      {error ? <Text style={ { color: C.red, fontSize: 13, marginTop: 12 }}>{error}</Text>: null}
      <View style={styles.pinGrid}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => (
          <TouchableOpacity key={i} style={[styles.pinKey, d === '' && { opacity: 0 }]}
            onPress={() => { if (d === '⌫') setPin(p => p.slice(0, -1)); else if (d) handlePin(d); }}
            disabled={d === ''}>
            <Text style={styles.pinKeyTxt}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

// ══════════════════════════════════════════════
// STAT CARD
// ══════════════════════════════════════════════
const StatCard = ({
  icon, label, value, color = C.gold, sub
}) => (
  <View style={[styles.statCard, { borderColor: color+'44' }]}>
    <Text style={ { fontSize: 26, marginBottom: 6 }}>{icon}</Text>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
    {sub ? <Text style={styles.statSub}>{sub}</Text>: null}
  </View>
);

// ══════════════════════════════════════════════
// SECTION HEADER
// ══════════════════════════════════════════════
const SectionHeader = ({
  title, count, color = C.gold
}) => (
  <View style={styles.sectionHeader}>
    <Text style={[styles.sectionTitle, { color }]}>{title}</Text>
    {count !== undefined && (
      <View style={[styles.countBadge, { backgroundColor: color+'22', borderColor: color+'44' }]}>
        <Text style={[styles.countBadgeTxt, { color }]}>{count}</Text>
      </View>
    )}
  </View>
);

// ══════════════════════════════════════════════
// PHOTO VIEWER MODAL
// ══════════════════════════════════════════════
const PhotoModal = ({
  visible, url, title, onClose
}) => (
  <Modal visible={visible} transparent animationType="fade">
    <View style={styles.photoModalBg}>
      <View style={styles.photoModalContent}>
        <View style={styles.photoModalHeader}>
          <Text style={ { color: C.gold, fontWeight: '800', fontSize: 15 }}>{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={ { color: C.gray, fontSize: 18 }}>✕</Text>
          </TouchableOpacity>
        </View>
        {url ? (
          <Image source={ { uri: url }} style={styles.photoFull} resizeMode="contain" />
        ): (
          <View style={[styles.photoFull, { justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={ { color: C.gray }}>No image available</Text>
          </View>
        )}
      </View>
    </View>
  </Modal>
);

// ══════════════════════════════════════════════
// MAIN ADMIN APP
// ══════════════════════════════════════════════
export default function AdminApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [refreshing, setRefreshing] = useState(false);
  const [photoModal, setPhotoModal] = useState( {
    visible: false, url: '', title: ''
  });
  const [pushModal, setPushModal] = useState(false);
  const [pushTarget, setPushTarget] = useState('all'); // 'all'|'drivers'|'passengers'|'user'
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushUserId, setPushUserId] = useState('');
  const [pushLoading, setPushLoading] = useState(false);
  const [rejectModal, setRejectModal] = useState( {
    visible: false, driverId: ''
  });
  const [rejectReason, setRejectReason] = useState('');
  const [userFilter, setUserFilter] = useState('all'); // 'all'|'drivers'|'passengers'|'suspended'

  // ── Load all data ──────────────────────────
  const loadAll = useCallback(async () => {
    dispatch( {
      type: 'SET_LOADING', p: true
    });
    await Promise.all([
      loadStats(),
      loadPendingDrivers(),
      loadUsers(),
      loadTopupRequests(),
      loadActiveTrips(),
    ]);
    dispatch( {
      type: 'SET_LOADING', p: false
    });
  }, []);

  useEffect(() => {
    if (state.authed) loadAll();
  },
    [state.authed]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  // ── Stats ──────────────────────────────────
  const loadStats = async () => {
    const today = new Date();
    today.setHours(0,
      0,
      0,
      0);
    const todayISO = today.toISOString();

    const [{
      count: totalUsers
    },
      {
        count: totalDrivers
      },
      {
        count: activeTrips
      },
      {
        count: pendingVerif
      },
      {
        count: todayTrips
      },
      {
        data: revenue
      },
      {
        count: pendingTopups
      },
    ] = await Promise.all([
        supabase.from('profiles').select('*', {
          count: 'exact', head: true
        }),
        supabase.from('profiles').select('*', {
          count: 'exact', head: true
        }).eq('role', 'driver'),
        supabase.from('trips').select('*', {
          count: 'exact', head: true
        }).in('status', ['searching', 'accepted', 'completion_requested', 'awaiting_driver_confirm']),
        supabase.from('profiles').select('*', {
          count: 'exact', head: true
        }).eq('verification_status', 'pending'),
        supabase.from('trips').select('*', {
          count: 'exact', head: true
        }).gte('created_at', todayISO),
        supabase.from('trips').select('commission').gte('created_at', todayISO).eq('status', 'completed'),
        supabase.from('topup_requests').select('*', {
          count: 'exact', head: true
        }).eq('status', 'pending'),
      ]);

    const todayRevenue = (revenue || []).reduce((s, t) => s+(t.commission || 0),
      0);

    dispatch( {
      type: 'SET_STATS',
      p: {
        totalUsers,
        totalDrivers,
        activeTrips,
        pendingVerif,
        todayTrips,
        todayRevenue,
        pendingTopups
      }
    });
  };

  // ── Pending driver verification ─────────────
  const loadPendingDrivers = async () => {
    const {
      data
    } = await supabase.from('profiles')
    .select('*').eq('role',
      'driver').eq('verification_status',
      'pending')
    .order('created_at',
      {
        ascending: false
      });
    dispatch( {
      type: 'SET_PENDING',
      p: data || []
    });
  };

  // ── All users ──────────────────────────────
  const loadUsers = async () => {
    let q = supabase.from('profiles').select('*').order('created_at',
      {
        ascending: false
      });
    if (userFilter === 'drivers') q = q.eq('role', 'driver');
    if (userFilter === 'passengers') q = q.eq('role', 'passenger');
    if (userFilter === 'suspended') q = q.eq('is_suspended', true);
    const {
      data
    } = await q.limit(100);
    dispatch( {
      type: 'SET_USERS', p: data || []
    });
  };

  useEffect(() => {
    if (state.authed) loadUsers();
  },
    [userFilter]);

  // ── Top-up requests ────────────────────────
  const loadTopupRequests = async () => {
    const {
      data
    } = await supabase.from('topup_requests')
    .select('*').order('created_at',
      {
        ascending: false
      }).limit(50);
    dispatch( {
      type: 'SET_TOPUPS',
      p: data || []
    });
  };

  // ── Active trips ───────────────────────────
  const loadActiveTrips = async () => {
    const {
      data
    } = await supabase.from('trips')
    .select('*').in('status',
      ['searching',
        'accepted',
        'completion_requested',
        'awaiting_driver_confirm'])
    .order('created_at',
      {
        ascending: false
      });
    dispatch( {
      type: 'SET_TRIPS',
      p: data || []
    });
  };

  // ── Driver verification actions ────────────
  const approveDriver = async (driverId) => {
    Alert.alert('Approve Driver',
      'Are you sure you want to approve this driver?',
      [{
        text: 'Cancel',
        style: 'cancel'
      },
        {
          text: 'Approve ✓',
          onPress: async () => {
            await supabase.from('profiles').update({
              verification_status: 'verified',
              verified: true,
              verified_at: new Date().toISOString(),
              is_suspended: false,
            }).eq('id', driverId);
            await supabase.from('admin_logs').insert([{
              admin_id: ADMIN_ID, action: 'approve_driver', target_id: driverId,
              details: 'Driver verification approved',
            }]);
            // Push notification to driver
            const {
              data: drv
            } = await supabase.from('profiles').select('push_token,name').eq('id', driverId).single();
            if (drv?.push_token) await sendExpoPush(drv.push_token, '✅ Account Verified!', `Congratulations ${drv.name}! Your MotoLink driver account is now verified. You can start accepting trips.`, {
              type: 'verified'
            });
            loadPendingDrivers(); loadStats();
            Alert.alert('✓', 'Driver approved and notified.');
          }}]
    );
  };

  const rejectDriver = async () => {
    if (!rejectReason.trim()) return Alert.alert('Error', 'Please enter a rejection reason.');
    await supabase.from('profiles').update({
      verification_status: 'rejected',
      verified: false,
      rejection_reason: rejectReason,
    }).eq('id', rejectModal.driverId);
    await supabase.from('admin_logs').insert([{
      admin_id: ADMIN_ID, action: 'reject_driver', target_id: rejectModal.driverId,
      details: `Rejected: ${rejectReason}`,
    }]);
    const {
      data: drv
    } = await supabase.from('profiles').select('push_token,name').eq('id', rejectModal.driverId).single();
    if (drv?.push_token) await sendExpoPush(drv.push_token, '❌ Verification Rejected', `Sorry ${drv.name}, your documents could not be verified. Reason: ${rejectReason}. Please resubmit.`, {
      type: 'rejected'
    });
    setRejectModal({
      visible: false, driverId: ''
    });
    setRejectReason('');
    loadPendingDrivers(); loadStats();
    Alert.alert('Done', 'Driver rejected and notified.');
  };

  // ── User management actions ────────────────
  const suspendUser = async (userId, name, isSuspended) => {
    const action = isSuspended ? 'unsuspend': 'suspend';
    Alert.alert(`${action.charAt(0).toUpperCase()+action.slice(1)} ${name}?`, '',
      [{
        text: 'Cancel', style: 'cancel'
      },
        {
          text: action.toUpperCase(), style: isSuspended?'default': 'destructive', onPress: async () => {
            await supabase.from('profiles').update({
              is_suspended: !isSuspended
            }).eq('id', userId);
            await supabase.from('admin_logs').insert([{
              admin_id: ADMIN_ID, action: `${action}_user`, target_id: userId, details: `User ${action}ed`,
            }]);
            const {
              data: u
            } = await supabase.from('profiles').select('push_token').eq('id', userId).single();
            if (u?.push_token) await sendExpoPush(u.push_token, isSuspended?'✅ Account Reinstated': '⚠️ Account Suspended', isSuspended?'Your MotoLink account has been reinstated. Welcome back!': 'Your account has been suspended. Contact support.', {
              type: action
            });
            loadUsers();
          }}]
    );
  };

  const deleteUser = async (userId,
    name) => {
    Alert.alert(`Delete ${name}?`,
      'This permanently deletes the account and all data.',
      [{
        text: 'Cancel',
        style: 'cancel'
      },
        {
          text: 'DELETE',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('trips').update({
              status: 'cancelled'
            }).or(`passenger_id.eq.${userId},driver_id.eq.${userId}`).in('status', ['searching', 'accepted']);
            await supabase.from('profiles').delete().eq('id', userId);
            await supabase.from('admin_logs').insert([{
              admin_id: ADMIN_ID, action: 'delete_user', target_id: userId, details: 'User deleted by admin'
            }]);
            loadUsers(); loadStats();
          }}]
    );
  };

  // ── Top-up approval ────────────────────────
  const approveTopup = async (request) => {
    Alert.alert(`Approve ${fmtFRW(request.amount)}?`,
      `Credit wallet for ${request.user_name}`,
      [{
        text: 'Cancel',
        style: 'cancel'
      },
        {
          text: 'APPROVE ✓',
          onPress: async () => {
            // Credit wallet
            const {
              data: profile
            } = await supabase.from('profiles').select('wallet_balance').eq('id', request.user_id).single();
            const newBalance = (profile?.wallet_balance || 0) + request.amount;
            await supabase.from('profiles').update({
              wallet_balance: newBalance
            }).eq('id', request.user_id);
            await supabase.from('transactions').insert([{
              user_id: request.user_id, type: 'topup', amount: request.amount,
              balance_after: newBalance, description: `Top-up via ${request.method?.toUpperCase()} — approved by admin`,
              status: 'completed', method: request.method,
            }]);
            await supabase.from('topup_requests').update({
              status: 'approved'
            }).eq('id', request.id);
            await supabase.from('admin_logs').insert([{
              admin_id: ADMIN_ID, action: 'approve_topup', target_id: request.user_id, details: `Credited ${request.amount} FRW`
            }]);
            const {
              data: u
            } = await supabase.from('profiles').select('push_token').eq('id', request.user_id).single();
            if (u?.push_token) await sendExpoPush(u.push_token, '💰 Wallet Credited!', `${fmtFRW(request.amount)} has been added to your MotoLink wallet.`, {
              type: 'wallet'
            });
            loadTopupRequests(); loadStats();
            Alert.alert('✓', `Wallet credited. New balance: ${fmtFRW(newBalance)}`);
          }}]
    );
  };

  const rejectTopup = async (requestId) => {
    await supabase.from('topup_requests').update({
      status: 'rejected'
    }).eq('id',
      requestId);
    loadTopupRequests();
  };

  // ── Cancel active trip ─────────────────────
  const cancelTripAdmin = async (tripId,
    passId,
    drvId) => {
    Alert.alert('Cancel Trip?',
      'Force cancel this active trip?',
      [{
        text: 'Cancel',
        style: 'cancel'
      },
        {
          text: 'FORCE CANCEL',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('trips').update({
              status: 'cancelled', cancelled_at: new Date().toISOString()
            }).eq('id', tripId);
            await supabase.from('admin_logs').insert([{
              admin_id: ADMIN_ID, action: 'cancel_trip', target_id: tripId, details: 'Force cancelled by admin'
            }]);
            for (const uid of [passId, drvId]) {
              const tk = await supabase.from('profiles').select('push_token').eq('id', uid).single();
              if (tk.data?.push_token) await sendExpoPush(tk.data.push_token, '⚠️ Trip Cancelled', 'This trip was cancelled by MotoLink admin.', {
                type: 'cancelled'
              });
            }
            loadActiveTrips(); loadStats();
          }}]
    );
  };

  // ── Custom push notification ───────────────
  const sendCustomPush = async () => {
    if (!pushTitle || !pushBody) return Alert.alert('Error', 'Title and message are required.');
    setPushLoading(true);
    let query = supabase.from('profiles').select('push_token');
    if (pushTarget === 'drivers') query = query.eq('role', 'driver');
    if (pushTarget === 'passengers') query = query.eq('role', 'passenger');
    if (pushTarget === 'user') query = query.eq('id', pushUserId);
    query = query.not('push_token', 'is', null);
    const {
      data: targets
    } = await query;
    if (!targets?.length) {
      setPushLoading(false); Alert.alert('No targets', 'No users found with push tokens.'); return;
    }
    for (const u of targets) if (u.push_token) await sendExpoPush(u.push_token, pushTitle, pushBody, {
      type: 'admin'
    });
    await supabase.from('admin_logs').insert([{
      admin_id: ADMIN_ID, action: 'push_sent', details: `To:${pushTarget} — ${pushTitle}`
    }]);
    setPushLoading(false);
    setPushModal(false);
    setPushTitle(''); setPushBody(''); setPushUserId('');
    Alert.alert('✓', `Push sent to ${targets.length} user${targets.length !== 1?'s': ''}.`);
  };

  // ── Fetch Supabase image URL ───────────────
  const getDocUrl = async (path) => {
    if (!path) return null;
    const {
      data
    } = supabase.storage.from('verification-docs').getPublicUrl(path);
    return data?.publicUrl || null;
  };

  const viewDoc = async (path, title) => {
    const url = await getDocUrl(path);
    setPhotoModal({
      visible: true, url, title
    });
  };

  // ══════════════════════════════════════════
  // RENDER TABS
  // ══════════════════════════════════════════

  // ── Dashboard Tab ─────────────────────────
  const renderDashboard = () => {
    const s = state.stats;
    return (
      <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
        <SectionHeader title="📊 Revenue Overview" color={C.gold} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ { marginBottom: 16 }}>
          <StatCard icon="💰" label="Today's Commission" value={fmtFRW(s?.todayRevenue || 0)} color={C.green} />
          <StatCard icon="🛵" label="Trips Today" value={fmtNum(s?.todayTrips || 0)} color={C.blue} />
          <StatCard icon="🔴" label="Active Now" value={fmtNum(s?.activeTrips || 0)} color={C.red} />
          <StatCard icon="👥" label="Total Users" value={fmtNum(s?.totalUsers || 0)} color={C.gold} />
          <StatCard icon="🏍️" label="Drivers" value={fmtNum(s?.totalDrivers || 0)} color={C.purple} />
          <StatCard icon="⏳" label="Pending Verify" value={fmtNum(s?.pendingVerif || 0)} color={C.orange} />
          <StatCard icon="📲" label="Pending Top-ups" value={fmtNum(s?.pendingTopups || 0)} color={C.blue} />
        </ScrollView>

        <SectionHeader title="⚡ Quick Actions" color={C.gold} />
        <View style={styles.quickActions}>
          {[{
            icon: '✅', label: 'Verify Drivers', tab: 'verification', badge: s?.pendingVerif, color: C.green
          },
            {
              icon: '📲', label: 'Approve Top-ups', tab: 'topups', badge: s?.pendingTopups, color: C.blue
            },
            {
              icon: '👥', label: 'Manage Users', tab: 'users', color: C.gold
            },
            {
              icon: '🛵', label: 'Active Trips', tab: 'trips', badge: s?.activeTrips, color: C.red
            },
            {
              icon: '📣', label: 'Send Push', action: ()=>setPushModal(true), color: C.purple
            },
          ].map((a, i) => (
              <TouchableOpacity key={i} style={[styles.quickActionBtn, { borderColor: a.color+'44' }]}
                onPress={a.action || (()=>dispatch( { type: 'SET_TAB', p: a.tab }))}>
                <Text style={ { fontSize: 22 }}>{a.icon}</Text>
                {a.badge ? <View style={[styles.quickBadge, { backgroundColor: a.color }]}><Text style={styles.quickBadgeTxt}>{a.badge}</Text></View>: null}
                <Text style={[styles.quickActionLabel, { color: a.color }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
        </View>

        <SectionHeader title="🔴 Active Trips" count={state.activeTrips.length} color={C.red} />
        {state.activeTrips.slice(0, 5).map(trip => (
          <View key={trip.id} style={styles.tripRow}>
            <View style={ { flex: 1 }}>
              <Text style={ { color: C.white, fontWeight: '700', fontSize: 13 }}>{trip.passenger_name || 'Passenger'} → {trip.driver_name || 'No driver yet'}</Text>
              <Text style={ { color: C.gray, fontSize: 11, marginTop: 2 }}>{trip.pickup_address} → {trip.destination_address}</Text>
              <View style={ { flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Text style={ { color: C.gold, fontWeight: '800', fontSize: 12 }}>{fmtFRW(trip.price)}</Text>
                <View style={[styles.statusPill, { backgroundColor: trip.status === 'searching'?C.orangeDim: C.greenDim, marginTop: 0 }]}>
                  <Text style={[styles.statusPillTxt, { color: trip.status === 'searching'?C.orange: C.green }]}>{trip.status}</Text>
                </View>
                <Text style={ { color: C.grayDark, fontSize: 10 }}>{fmtTime(trip.created_at)}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.forceCancel} onPress={()=>cancelTripAdmin(trip.id, trip.passenger_id, trip.driver_id)}>
              <Text style={ { color: C.red, fontSize: 10, fontWeight: '900' }}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        ))}
        {state.activeTrips.length > 5 && (
          <TouchableOpacity onPress={()=>dispatch( { type: 'SET_TAB', p: 'trips' })}>
            <Text style={ { color: C.blue, textAlign: 'center', fontSize: 13, marginBottom: 20 }}>View all {state.activeTrips.length} active trips →</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  };

  // ── Verification Tab ───────────────────────
  const renderVerification = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <SectionHeader title="✅ Driver Verification Queue" count={state.pendingDrivers.length} color={C.green} />
      {state.pendingDrivers.length === 0 && <Text style={styles.emptyText}>No pending verifications.</Text>}
      {state.pendingDrivers.map(drv => (
        <View key={drv.id} style={styles.verifCard}>
          {/* Driver info */}
          <View style={styles.verifHeader}>
            <View style={styles.verifAvatar}><Text style={styles.verifAvatarTxt}>{drv.name?.substring(0, 2).toUpperCase() || 'DR'}</Text></View>
            <View style={ { flex: 1, marginLeft: 12 }}>
              <Text style={ { color: C.white, fontWeight: '800', fontSize: 15 }}>{drv.name}</Text>
              <Text style={ { color: C.gray, fontSize: 12, marginTop: 2 }}>{drv.phone}</Text>
              <Text style={ { color: C.grayDark, fontSize: 11, marginTop: 1 }}>Plate: {drv.plate || '—'}</Text>
              <Text style={ { color: C.grayDark, fontSize: 11 }}>Joined: {fmtDate(drv.created_at)}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: C.orangeDim, marginTop: 0 }]}>
              <Text style={[styles.statusPillTxt, { color: C.orange }]}>PENDING</Text>
            </View>
          </View>

          {/* Document thumbnails */}
          <Text style={[styles.inputLabel, { marginTop: 12, marginBottom: 8 }]}>UPLOADED DOCUMENTS</Text>
          <View style={styles.docRow}>
            {[{
              label: 'National ID', path: drv.national_id_url
            },
              {
                label: "Driver's Licence", path: drv.licence_url
              },
              {
                label: 'Plate Photo', path: drv.plate_photo_url
              },
            ].map((doc, i) => (
                <TouchableOpacity key={i} style={styles.docThumb} onPress={()=>viewDoc(doc.path, doc.label)}>
                  {doc.path ? (
                    <Image source={ { uri: `${supabase.storage.from('verification-docs').getPublicUrl(doc.path).data?.publicUrl}` }} style={styles.docThumbImg} resizeMode="cover" />
                  ): (
                    <View style={[styles.docThumbImg, { justifyContent: 'center', alignItems: 'center', backgroundColor: C.card2 }]}>
                      <Text style={ { color: C.grayDark, fontSize: 10 }}>No file</Text>
                    </View>
                  )}
                  <Text style={styles.docThumbLabel}>{doc.label}</Text>
                </TouchableOpacity>
              ))}
          </View>

          {/* Actions */}
          <View style={ { flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.greenDim, borderColor: C.green, flex: 1 }]}
              onPress={()=>approveDriver(drv.id)}>
              <Text style={[styles.actionBtnTxt, { color: C.green }]}>✓ APPROVE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: C.redDim, borderColor: C.red, flex: 1 }]}
              onPress={()=>setRejectModal({ visible: true, driverId: drv.id })}>
              <Text style={[styles.actionBtnTxt, { color: C.red }]}>✕ REJECT</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );

  // ── Users Tab ──────────────────────────────
  const renderUsers = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <SectionHeader title="👥 User Management" count={state.users.length} color={C.gold} />
      {/* Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ { marginBottom: 14 }}>
        {['all', 'drivers', 'passengers', 'suspended'].map(f => (
          <TouchableOpacity key={f} style={[styles.filterBtn, userFilter === f && styles.filterBtnActive]}
            onPress={()=>setUserFilter(f)}>
            <Text style={[styles.filterBtnTxt, userFilter === f && { color: C.gold }]}>
              {f.charAt(0).toUpperCase()+f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {state.users.map(u => (
        <View key={u.id} style={styles.userRow}>
          <View style={styles.userAvatar}><Text style={styles.userAvatarTxt}>{u.name?.substring(0, 2).toUpperCase() || '??'}</Text></View>
          <View style={ { flex: 1, marginLeft: 10 }}>
            <View style={ { flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={ { color: C.white, fontWeight: '700', fontSize: 13 }}>{u.name || 'Unknown'}</Text>
              {u.is_suspended && <View style={[styles.statusPill, { backgroundColor: C.redDim, marginTop: 0, paddingVertical: 2, paddingHorizontal: 6 }]}><Text style={[styles.statusPillTxt, { color: C.red, fontSize: 9 }]}>SUSPENDED</Text></View>}
              {u.verified && <View style={[styles.statusPill, { backgroundColor: C.greenDim, marginTop: 0, paddingVertical: 2, paddingHorizontal: 6 }]}><Text style={[styles.statusPillTxt, { color: C.green, fontSize: 9 }]}>✓ VERIFIED</Text></View>}
            </View>
            <Text style={ { color: C.gray, fontSize: 11, marginTop: 1 }}>{u.phone} · {u.role}</Text>
            <Text style={ { color: C.grayDark, fontSize: 10, marginTop: 1 }}>★ {(u.rating || 5.0).toFixed(1)} · {u.total_ratings || 0} ratings · Wallet: {fmtFRW(u.wallet_balance)}</Text>
          </View>
          <View style={ { gap: 6 }}>
            <TouchableOpacity style={[styles.miniBtn, { borderColor: u.is_suspended?C.green: C.orange }]}
              onPress={()=>suspendUser(u.id, u.name || 'User', u.is_suspended)}>
              <Text style={[styles.miniBtnTxt, { color: u.is_suspended?C.green: C.orange }]}>
                {u.is_suspended?'LIFT': 'SUSPEND'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.miniBtn, { borderColor: C.red }]} onPress={()=>deleteUser(u.id, u.name || 'User')}>
              <Text style={[styles.miniBtnTxt, { color: C.red }]}>DELETE</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );

  // ── Top-ups Tab ────────────────────────────
  const renderTopups = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <SectionHeader title="📲 Top-up Requests" color={C.blue} />
      {state.topupRequests.length === 0 && <Text style={styles.emptyText}>No top-up requests.</Text>}
      {state.topupRequests.map(req => (
        <View key={req.id} style={styles.topupCard}>
          <View style={ { flex: 1 }}>
            <View style={ { flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={ { color: C.white, fontWeight: '800', fontSize: 15 }}>{fmtFRW(req.amount)}</Text>
              <View style={[styles.statusPill, {
                backgroundColor: req.status === 'pending'?C.orangeDim: req.status === 'approved'?C.greenDim: C.redDim,
                marginTop: 0, paddingVertical: 2, paddingHorizontal: 8,
              }]}>
                <Text style={[styles.statusPillTxt, {
                  color: req.status === 'pending'?C.orange: req.status === 'approved'?C.green: C.red,
                }]}>{req.status?.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={ { color: C.gray, fontSize: 12, marginTop: 4 }}>{req.user_name} · {req.user_phone}</Text>
            <Text style={ { color: C.gray, fontSize: 12 }}>Method: {req.method?.toUpperCase()} · From: {req.reference}</Text>
            <Text style={ { color: C.grayDark, fontSize: 11, marginTop: 2 }}>{fmtDT(req.created_at)}</Text>
          </View>
          {req.status === 'pending' && (
            <View style={ { gap: 6, marginLeft: 10 }}>
              <TouchableOpacity style={[styles.miniBtn, { borderColor: C.green }]} onPress={()=>approveTopup(req)}>
                <Text style={[styles.miniBtnTxt, { color: C.green }]}>APPROVE</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.miniBtn, { borderColor: C.red }]} onPress={()=>rejectTopup(req.id)}>
                <Text style={[styles.miniBtnTxt, { color: C.red }]}>REJECT</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );

  // ── Trips Tab ──────────────────────────────
  const renderTrips = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <SectionHeader title="🛵 All Active Trips" count={state.activeTrips.length} color={C.red} />
      {state.activeTrips.length === 0 && <Text style={styles.emptyText}>No active trips right now.</Text>}
      {state.activeTrips.map(trip => (
        <View key={trip.id} style={styles.tripCard}>
          <View style={ { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={ { flex: 1 }}>
              <View style={ { flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={ { color: C.gold, fontWeight: '900', fontSize: 16 }}>{fmtFRW(trip.price)}</Text>
                <View style={[styles.statusPill, { backgroundColor: trip.status === 'searching'?C.orangeDim: C.greenDim, marginTop: 0 }]}>
                  <Text style={[styles.statusPillTxt, { color: trip.status === 'searching'?C.orange: C.green }]}>{trip.status}</Text>
                </View>
              </View>
              <Text style={ { color: C.gray, fontSize: 12, marginTop: 6 }}>🧑 {trip.passenger_name || '—'} · {trip.passenger_phone}</Text>
              {trip.driver_name && <Text style={ { color: C.gray, fontSize: 12 }}>🏍️ {trip.driver_name} · {trip.driver_phone}</Text>}
              <View style={styles.routeBlock}>
                <View style={styles.routeDot} />
                <Text style={ { color: C.gray, fontSize: 11, flex: 1 }} numberOfLines={1}>{trip.pickup_address}</Text>
              </View>
              <View style={styles.routeLine_} />
              <View style={styles.routeBlock}>
                <View style={[styles.routeDot, { backgroundColor: C.green }]} />
                <Text style={ { color: C.offWhite, fontSize: 11, flex: 1 }} numberOfLines={1}>{trip.destination_address}</Text>
              </View>
              <Text style={ { color: C.grayDark, fontSize: 11, marginTop: 4 }}>Created: {fmtDT(trip.created_at)}</Text>
            </View>
            <TouchableOpacity style={styles.forceCancel} onPress={()=>cancelTripAdmin(trip.id, trip.passenger_id, trip.driver_id)}>
              <Text style={ { color: C.red, fontSize: 10, fontWeight: '900' }}>FORCE{'\n'}CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );

  // ══════════════════════════════════════════
  // ROOT RENDER
  // ══════════════════════════════════════════
  if (!state.authed) return <PinScreen onAuth={()=>dispatch( { type: 'AUTH' })} />;

  const TABS = [{
    key: 'dashboard',
    icon: '📊',
    label: 'Dashboard'
  },
    {
      key: 'verification',
      icon: '✅',
      label: 'Verify',
      badge: state.stats?.pendingVerif
    },
    {
      key: 'users',
      icon: '👥',
      label: 'Users'
    },
    {
      key: 'topups',
      icon: '📲',
      label: 'Top-ups',
      badge: state.stats?.pendingTopups
    },
    {
      key: 'trips',
      icon: '🛵',
      label: 'Trips',
      badge: state.stats?.activeTrips
    },
  ];

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={C.black} />

        {/* Header */}
        <SafeAreaView edges={['top']} style={styles.adminHeader}>
          <View style={ { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={ { flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={styles.splashLogoRingSmall}><Text style={styles.splashLogoTxtSmall}>ML</Text></View>
              <Text style={styles.adminHeaderTxt}>ADMIN PANEL</Text>
            </View>
            <View style={ { flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={styles.headerBtn} onPress={()=>setPushModal(true)}>
                <Text style={ { fontSize: 16 }}>📣</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerBtn} onPress={onRefresh}>
                <Text style={ { fontSize: 16 }}>🔄</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>

        {/* Loading bar */}
        {state.loading && <View style={styles.loadingBar}><ActivityIndicator color={C.gold} size="small" /></View>}

        {/* Tab content */}
        <ScrollView
          style={ { flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.gold} />}
          showsVerticalScrollIndicator={false}
          >
          {state.tab === 'dashboard' && renderDashboard()}
          {state.tab === 'verification' && renderVerification()}
          {state.tab === 'users' && renderUsers()}
          {state.tab === 'topups' && renderTopups()}
          {state.tab === 'trips' && renderTrips()}
        </ScrollView>

        {/* Bottom Tab Bar */}
        <SafeAreaView edges={['bottom']} style={styles.tabBar}>
          {TABS.map(tab => (
            <TouchableOpacity key={tab.key} style={styles.tabItem}
              onPress={()=>dispatch( { type: 'SET_TAB', p: tab.key })}>
              <View style={ { position: 'relative' }}>
                <Text style={ { fontSize: 20 }}>{tab.icon}</Text>
                {tab.badge > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeTxt}>{tab.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, state.tab === tab.key && { color: C.gold }]}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </SafeAreaView>

        {/* Photo viewer modal */}
        <PhotoModal visible={photoModal.visible} url={photoModal.url} title={photoModal.title}
          onClose={()=>setPhotoModal({ visible: false, url: '', title: '' })} />

        {/* Reject reason modal */}
        <Modal visible={rejectModal.visible} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={styles.glassModal}>
              <Text style={ { color: C.red, fontWeight: '900', fontSize: 18, marginBottom: 16 }}>❌ Reject Driver</Text>
              <Text style={styles.inputLabel}>REJECTION REASON</Text>
              <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top', marginBottom: 16 }]}
                placeholder="e.g. Documents unclear, ID expired..." placeholderTextColor={C.grayDark}
                value={rejectReason} onChangeText={setRejectReason} multiline />
              <TouchableOpacity style={[styles.mainBtn, { backgroundColor: C.red }]} onPress={rejectDriver}>
                <Text style={[styles.mainBtnTxt, { color: C.white }]}>SEND REJECTION</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>setRejectModal({ visible: false, driverId: '' })} style={ { marginTop: 14 }}>
                <Text style={ { color: C.gray, textAlign: 'center' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Push notification modal */}
        <Modal visible={pushModal} transparent animationType="slide">
          <View style={styles.modalBg}>
            <ScrollView contentContainerStyle={styles.glassModal} keyboardShouldPersistTaps="handled">
              <Text style={ { color: C.gold, fontWeight: '900', fontSize: 18, marginBottom: 16 }}>📣 Send Push Notification</Text>
              <Text style={styles.inputLabel}>SEND TO</Text>
              <View style={ { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {['all', 'drivers', 'passengers', 'user'].map(tgt => (
                  <TouchableOpacity key={tgt} style={[styles.filterBtn, pushTarget === tgt && styles.filterBtnActive]}
                    onPress={()=>setPushTarget(tgt)}>
                    <Text style={[styles.filterBtnTxt, pushTarget === tgt && { color: C.gold }]}>{tgt.charAt(0).toUpperCase()+tgt.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {pushTarget === 'user' && (
                <View style={styles.inputWrap}>
                  <Text style={styles.inputLabel}>USER ID</Text>
                  <TextInput style={styles.input} placeholder="Paste user UUID..." placeholderTextColor={C.grayDark} value={pushUserId} onChangeText={setPushUserId} />
                </View>
              )}
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>TITLE</Text>
                <TextInput style={styles.input} placeholder="Notification title..." placeholderTextColor={C.grayDark} value={pushTitle} onChangeText={setPushTitle} />
              </View>
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>MESSAGE</Text>
                <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                  placeholder="Notification message..." placeholderTextColor={C.grayDark}
                  value={pushBody} onChangeText={setPushBody} multiline />
              </View>
              <TouchableOpacity style={styles.mainBtn} onPress={sendCustomPush} disabled={pushLoading}>
                {pushLoading ? <ActivityIndicator color={C.black} />: <Text style={styles.mainBtnTxt}>📣 SEND PUSH</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>setPushModal(false)} style={ { marginTop: 14 }}>
                <Text style={ { color: C.gray, textAlign: 'center' }}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>
      </View>
    </SafeAreaProvider>
  );
}

// ══════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════
const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: C.black
  },
  adminHeader: {
    backgroundColor: C.card, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border
  },
  adminHeaderTxt: {
    color: C.gold, fontWeight: '900', fontSize: 18, letterSpacing: 3
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: C.goldDim, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border
  },
  loadingBar: {
    height: 36, backgroundColor: C.card2, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderColor: C.border
  },
  tabContent: {
    flex: 1, padding: 16
  },
  tabBar: {
    flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderColor: C.border, paddingVertical: 6
  },
  tabItem: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6
  },
  tabLabel: {
    color: C.gray, fontSize: 10, marginTop: 3, fontWeight: '600'
  },
  tabBadge: {
    position: 'absolute', top: -4, right: -8, backgroundColor: C.red, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3
  },
  tabBadgeTxt: {
    color: C.white, fontSize: 9, fontWeight: '900'
  },

  // Pin screen
  pinScreen: {
    flex: 1, backgroundColor: C.black, justifyContent: 'center', alignItems: 'center', padding: 40
  },
  pinTitle: {
    color: C.gold, fontSize: 26, fontWeight: '900', letterSpacing: 4, marginBottom: 8
  },
  pinDotsRow: {
    flexDirection: 'row', gap: 14, marginBottom: 40
  },
  pinDot: {
    width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: C.gold, backgroundColor: 'transparent'
  },
  pinDotFilled: {
    backgroundColor: C.gold
  },
  pinGrid: {
    flexDirection: 'row', flexWrap: 'wrap', width: 240, gap: 12, justifyContent: 'center'
  },
  pinKey: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center'
  },
  pinKeyTxt: {
    color: C.white, fontSize: 22, fontWeight: '700'
  },

  // Stat cards
  statCard: {
    width: 140, backgroundColor: C.card, borderRadius: 18, padding: 16, marginRight: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center'
  },
  statValue: {
    fontSize: 22, fontWeight: '900', letterSpacing: 1
  },
  statLabel: {
    color: C.gray, fontSize: 11, marginTop: 4, textAlign: 'center'
  },
  statSub: {
    color: C.grayDark, fontSize: 10, marginTop: 2
  },

  // Section
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 8
  },
  sectionTitle: {
    fontWeight: '900', fontSize: 15, letterSpacing: 0.5, flex: 1
  },
  countBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, borderWidth: 1
  },
  countBadgeTxt: {
    fontWeight: '900', fontSize: 12
  },

  // Quick actions
  quickActions: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20
  },
  quickActionBtn: {
    width: (width-52)/3, backgroundColor: C.card, borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1
  },
  quickActionLabel: {
    fontSize: 11, fontWeight: '700', marginTop: 6, textAlign: 'center'
  },
  quickBadge: {
    position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center'
  },
  quickBadgeTxt: {
    color: C.white, fontSize: 9, fontWeight: '900'
  },

  // Verification
  verifCard: {
    backgroundColor: C.card, borderRadius: 18, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border
  },
  verifHeader: {
    flexDirection: 'row', alignItems: 'flex-start'
  },
  verifAvatar: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: C.goldDim, borderWidth: 2, borderColor: C.gold, justifyContent: 'center', alignItems: 'center'
  },
  verifAvatarTxt: {
    color: C.gold, fontWeight: '900', fontSize: 16
  },
  docRow: {
    flexDirection: 'row', gap: 10
  },
  docThumb: {
    flex: 1, alignItems: 'center'
  },
  docThumbImg: {
    width: '100%', height: 80, borderRadius: 10, backgroundColor: C.card2, borderWidth: 1, borderColor: C.borderFaint
  },
  docThumbLabel: {
    color: C.gray, fontSize: 10, marginTop: 4, textAlign: 'center'
  },
  actionBtn: {
    padding: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1.5
  },
  actionBtnTxt: {
    fontWeight: '900', fontSize: 13, letterSpacing: 0.5
  },

  // Users
  userRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, padding: 12, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: C.borderFaint
  },
  userAvatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.goldDim, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center'
  },
  userAvatarTxt: {
    color: C.gold, fontWeight: '900', fontSize: 13
  },
  miniBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5, alignItems: 'center'
  },
  miniBtnTxt: {
    fontWeight: '900', fontSize: 10, letterSpacing: 0.5
  },
  filterBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: C.borderFaint, backgroundColor: C.card2, marginRight: 6
  },
  filterBtnActive: {
    borderColor: C.gold, backgroundColor: C.goldDim
  },
  filterBtnTxt: {
    color: C.gray, fontWeight: '700', fontSize: 12
  },

  // Top-ups
  topupCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, padding: 14, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: C.borderFaint
  },

  // Trips
  tripRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, padding: 12, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: C.borderFaint
  },
  tripCard: {
    backgroundColor: C.card, padding: 14, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: C.borderFaint
  },
  forceCancel: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: C.red, marginLeft: 10, alignItems: 'center'
  },

  // Route display
  routeBlock: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4
  },
  routeDot: {
    width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.gold, flexShrink: 0
  },
  routeLine_: {
    width: 1, height: 10, backgroundColor: C.border, marginLeft: 3, marginVertical: 2
  },

  // Shared
  statusPill: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 16, marginTop: 6
  },
  statusPillTxt: {
    fontSize: 10, fontWeight: '900', letterSpacing: 0.5
  },
  inputWrap: {
    marginBottom: 14
  },
  inputLabel: {
    color: C.gray, fontSize: 11, letterSpacing: 1.2, marginBottom: 6, marginLeft: 2, textTransform: 'uppercase'
  },
  input: {
    backgroundColor: C.card2, color: C.white, padding: 14, borderRadius: 12, fontSize: 14, borderWidth: 1, borderColor: C.borderFaint
  },
  mainBtn: {
    backgroundColor: C.gold, padding: 16, borderRadius: 14, alignItems: 'center', elevation: 6
  },
  mainBtnTxt: {
    color: C.black, fontWeight: '900', fontSize: 14, letterSpacing: 1
  },
  emptyText: {
    color: C.grayDark, textAlign: 'center', padding: 30, fontStyle: 'italic'
  },

  // Photo modal
  photoModalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', padding: 20
  },
  photoModalContent: {
    backgroundColor: C.card, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.border
  },
  photoModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: C.borderFaint
  },
  photoFull: {
    width: '100%', height: 300
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.card2, justifyContent: 'center', alignItems: 'center'
  },

  // Modal
  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', padding: 20
  },
  glassModal: {
    backgroundColor: C.card, padding: 22, borderRadius: 22, borderWidth: 1, borderColor: C.border
  },

  // Logo
  splashLogoRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: C.gold, backgroundColor: C.goldDim, justifyContent: 'center', alignItems: 'center', marginBottom: 12
  },
  splashLogoTxt: {
    color: C.gold, fontWeight: '900', fontSize: 22, letterSpacing: 2
  },
  splashLogoRingSmall: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: C.gold, backgroundColor: C.goldDim, justifyContent: 'center', alignItems: 'center'
  },
  splashLogoTxtSmall: {
    color: C.gold, fontWeight: '900', fontSize: 11, letterSpacing: 1
  },
});