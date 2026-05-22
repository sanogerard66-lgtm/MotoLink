/**
 * MOTOLINK — Android Home Screen Widgets
 *
 * Two widgets:
 * 1. Passenger Widget — Active trip status + wallet balance + nearby drivers
 * 2. Driver Widget   — Earnings today + active job + rating
 *
 * Setup:
 * 1. Add to app.json under "plugins": ["react-native-android-widget"]
 * 2. Register widgets in this file
 * 3. Import and call registerWidgetTaskHandler() in your index.js
 *
 * app.json plugin config:
 * {
 *   "plugin": "react-native-android-widget",
 *   "widgetProviders": [
 *     {
 *       "name": "PassengerWidget",
 *       "label": "MotoLink — Passenger",
 *       "description": "Active trip & wallet",
 *       "minWidth": "180dp",
 *       "minHeight": "110dp",
 *       "targetCellWidth": 3,
 *       "targetCellHeight": 2,
 *       "previewImage": "./assets/widget-passenger-preview.png",
 *       "updatePeriodMillis": 1800000
 *     },
 *     {
 *       "name": "DriverWidget",
 *       "label": "MotoLink — Driver",
 *       "description": "Earnings & active job",
 *       "minWidth": "180dp",
 *       "minHeight": "110dp",
 *       "targetCellWidth": 3,
 *       "targetCellHeight": 2,
 *       "previewImage": "./assets/widget-driver-preview.png",
 *       "updatePeriodMillis": 1800000
 *     }
 *   ]
 * }
 */

import React from 'react';
import {
  FlexWidget,
  TextWidget,
  ImageWidget,
  ListWidget,
} from 'react-native-android-widget';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const STORAGE_KEY = '@motolink_session_v4';

// ══════════════════════════════════════════════
// COLORS (widget — must be hex strings)
// ══════════════════════════════════════════════
const WC = {
  black:    '#0A0A0A',
  card:     '#1A1A1A',
  gold:     '#D4AF37',
  goldDim:  '#2A2510',
  white:    '#FFFFFF',
  gray:     '#A0A0A0',
  green:    '#2ECC71',
  red:      '#FF4C4C',
  blue:     '#3498DB',
  orange:   '#F39C12',
  border:   '#2A2410',
};

// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════
const fmtFRW = (n) => `${(n||0).toLocaleString()} FRW`;
const fmtTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([],{ hour:'2-digit', minute:'2-digit' });
};

// ══════════════════════════════════════════════
// DATA FETCHERS
// ══════════════════════════════════════════════
const getWidgetData = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { session, role } = JSON.parse(raw);
    if (!session?.user?.id) return null;

    const userId = session.user.id;

    // Fetch profile
    const { data:profile } = await supabase.from('profiles')
      .select('name, wallet_balance, rating, role, momo_name')
      .eq('id', userId).single();

    if (!profile) return null;

    const userRole = role || profile.role;

    if (userRole === 'passenger') {
      // Active trip
      const { data:trips } = await supabase.from('trips')
        .select('*').eq('passenger_id', userId)
        .in('status',['searching','accepted','completion_requested'])
        .order('created_at',{ ascending:false }).limit(1);

      // Nearby drivers count
      const { count:nearbyDrivers } = await supabase.from('profiles')
        .select('*',{ count:'exact', head:true })
        .eq('role','driver').eq('is_suspended',false).eq('verified',true);

      return {
        role: 'passenger',
        name: profile.name,
        walletBalance: profile.wallet_balance || 0,
        activeTrip: trips?.[0] || null,
        nearbyDrivers: nearbyDrivers || 0,
      };
    } else {
      // Driver: today's earnings
      const today = new Date();
      today.setHours(0,0,0,0);
      const { data:trips } = await supabase.from('trips')
        .select('driver_earnings, status, pickup_address, destination_address, price, created_at')
        .eq('driver_id', userId)
        .gte('created_at', today.toISOString())
        .order('created_at',{ ascending:false });

      const completedToday = (trips||[]).filter(t => t.status==='completed');
      const earningsToday  = completedToday.reduce((s,t) => s+(t.driver_earnings||0), 0);
      const activeTrip     = (trips||[]).find(t => ['accepted','completion_requested','awaiting_driver_confirm'].includes(t.status));

      return {
        role: 'driver',
        name: profile.name,
        rating: profile.rating || 5.0,
        earningsToday,
        tripsToday: completedToday.length,
        activeTrip: activeTrip || null,
        hasPayment: !!profile.momo_name,
      };
    }
  } catch (e) {
    console.warn('Widget data error:', e);
    return null;
  }
};

// ══════════════════════════════════════════════
// PASSENGER WIDGET
// ══════════════════════════════════════════════
function PassengerWidget({ data }) {
  const hasTrip = !!data?.activeTrip;
  const trip    = data?.activeTrip;

  const statusColor = !hasTrip ? WC.gray :
    trip.status === 'accepted'              ? WC.green :
    trip.status === 'completion_requested'  ? WC.blue  : WC.orange;

  const statusText = !hasTrip ? 'No active trip' :
    trip.status === 'searching'             ? '⏳ Finding driver...' :
    trip.status === 'accepted'              ? '🏍️ Driver on the way' :
    trip.status === 'completion_requested'  ? '🏁 Confirm complete' : trip.status;

  return (
    <FlexWidget
      style={{
        height:'match_parent', width:'match_parent',
        flexDirection:'column',
        backgroundColor:WC.card,
        borderRadius:20,
        padding:14,
      }}
      clickAction="OPEN_APP"
    >
      {/* Header */}
      <FlexWidget style={{ flexDirection:'row', alignItems:'center', marginBottom:10 }}>
        <FlexWidget style={{
          width:28, height:28, borderRadius:14,
          backgroundColor:WC.goldDim, borderColor:WC.gold,
          justifyContent:'center', alignItems:'center', marginRight:8,
        }}>
          <TextWidget text="ML" style={{ color:WC.gold, fontWeight:'bold', fontSize:10 }}/>
        </FlexWidget>
        <TextWidget text="MotoLink" style={{ color:WC.gold, fontWeight:'bold', fontSize:13, flex:1 }}/>
        <TextWidget text={`💳 ${fmtFRW(data?.walletBalance||0)}`} style={{ color:WC.white, fontSize:11 }}/>
      </FlexWidget>

      {/* Active trip or status */}
      <FlexWidget style={{
        backgroundColor:WC.black, borderRadius:12, padding:10,
        flex:1, justifyContent:'center',
      }}>
        {hasTrip ? (
          <FlexWidget style={{ flexDirection:'column', gap:4 }}>
            <TextWidget text={statusText} style={{ color:statusColor, fontWeight:'bold', fontSize:12 }}/>
            <TextWidget
              text={`📍 ${trip.pickup_address?.substring(0,28)||'Current location'}`}
              style={{ color:WC.gray, fontSize:10 }}
            />
            <TextWidget
              text={`🟢 ${trip.destination_address?.substring(0,28)||'—'}`}
              style={{ color:WC.white, fontSize:10 }}
            />
            <TextWidget
              text={`${fmtFRW(trip.price)} · ${fmtTime(trip.created_at)}`}
              style={{ color:WC.gold, fontSize:10, fontWeight:'bold', marginTop:2 }}
            />
          </FlexWidget>
        ) : (
          <FlexWidget style={{ flexDirection:'column', alignItems:'center', gap:4 }}>
            <TextWidget text="🛵" style={{ fontSize:24 }}/>
            <TextWidget text="No active trip" style={{ color:WC.gray, fontSize:12 }}/>
            <TextWidget text="Tap to request a ride" style={{ color:WC.gold, fontSize:11 }}/>
          </FlexWidget>
        )}
      </FlexWidget>

      {/* Footer: nearby drivers */}
      <FlexWidget style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
        <TextWidget
          text={`🏍️ ${data?.nearbyDrivers||0} drivers available`}
          style={{ color:WC.gray, fontSize:10 }}
        />
        <TextWidget text="Tap to open →" style={{ color:WC.gold, fontSize:10 }}/>
      </FlexWidget>
    </FlexWidget>
  );
}

// ══════════════════════════════════════════════
// DRIVER WIDGET
// ══════════════════════════════════════════════
function DriverWidget({ data }) {
  const hasJob = !!data?.activeTrip;
  const job    = data?.activeTrip;

  const stars = Math.round(data?.rating||5);
  const starsStr = '★'.repeat(stars) + '☆'.repeat(5-stars);

  return (
    <FlexWidget
      style={{
        height:'match_parent', width:'match_parent',
        flexDirection:'column',
        backgroundColor:WC.card,
        borderRadius:20,
        padding:14,
      }}
      clickAction="OPEN_APP"
    >
      {/* Header */}
      <FlexWidget style={{ flexDirection:'row', alignItems:'center', marginBottom:10 }}>
        <FlexWidget style={{
          width:28, height:28, borderRadius:14,
          backgroundColor:WC.goldDim,
          justifyContent:'center', alignItems:'center', marginRight:8,
        }}>
          <TextWidget text="ML" style={{ color:WC.gold, fontWeight:'bold', fontSize:10 }}/>
        </FlexWidget>
        <TextWidget text={data?.name||'Driver'} style={{ color:WC.white, fontWeight:'bold', fontSize:13, flex:1 }}/>
        <TextWidget text={starsStr} style={{ color:WC.gold, fontSize:11 }}/>
      </FlexWidget>

      {/* Earnings today */}
      <FlexWidget style={{
        backgroundColor:WC.goldDim, borderRadius:12, padding:10,
        flexDirection:'row', alignItems:'center', justifyContent:'space-between',
        marginBottom:8,
      }}>
        <FlexWidget style={{ flexDirection:'column' }}>
          <TextWidget text="Today's Earnings" style={{ color:WC.gray, fontSize:10 }}/>
          <TextWidget
            text={fmtFRW(data?.earningsToday||0)}
            style={{ color:WC.gold, fontWeight:'bold', fontSize:16 }}
          />
        </FlexWidget>
        <FlexWidget style={{ flexDirection:'column', alignItems:'flex-end' }}>
          <TextWidget text="Trips" style={{ color:WC.gray, fontSize:10 }}/>
          <TextWidget
            text={String(data?.tripsToday||0)}
            style={{ color:WC.white, fontWeight:'bold', fontSize:16 }}
          />
        </FlexWidget>
      </FlexWidget>

      {/* Active job or idle */}
      <FlexWidget style={{
        backgroundColor:WC.black, borderRadius:12, padding:10, flex:1,
      }}>
        {hasJob ? (
          <FlexWidget style={{ flexDirection:'column', gap:3 }}>
            <TextWidget
              text={job.status==='accepted'?'🟢 Active Job':job.status==='awaiting_driver_confirm'?'💰 Awaiting payment':'🏁 Completion requested'}
              style={{ color:job.status==='accepted'?WC.green:WC.orange, fontWeight:'bold', fontSize:11 }}
            />
            <TextWidget
              text={`📍 ${job.pickup_address?.substring(0,26)||'Pickup'}`}
              style={{ color:WC.gray, fontSize:10 }}
            />
            <TextWidget
              text={`🟢 ${job.destination_address?.substring(0,26)||'Destination'}`}
              style={{ color:WC.white, fontSize:10 }}
            />
            <TextWidget
              text={fmtFRW(job.price)}
              style={{ color:WC.gold, fontWeight:'bold', fontSize:12, marginTop:2 }}
            />
          </FlexWidget>
        ) : (
          <FlexWidget style={{ flexDirection:'column', alignItems:'center', justifyContent:'center', flex:1 }}>
            <TextWidget text="No active job" style={{ color:WC.gray, fontSize:12 }}/>
            <TextWidget text="Open app to find rides" style={{ color:WC.gold, fontSize:11, marginTop:4 }}/>
            {!data?.hasPayment && (
              <TextWidget text="⚠️ Set up payment info" style={{ color:WC.orange, fontSize:10, marginTop:4 }}/>
            )}
          </FlexWidget>
        )}
      </FlexWidget>

      {/* Rating footer */}
      <TextWidget
        text={`★ ${(data?.rating||5.0).toFixed(1)} rating · Tap to open`}
        style={{ color:WC.gray, fontSize:10, marginTop:8 }}
      />
    </FlexWidget>
  );
}

// ══════════════════════════════════════════════
// LOADING / ERROR WIDGET (fallback)
// ══════════════════════════════════════════════
function LoadingWidget() {
  return (
    <FlexWidget
      style={{
        height:'match_parent', width:'match_parent',
        justifyContent:'center', alignItems:'center',
        backgroundColor:WC.card, borderRadius:20,
      }}
      clickAction="OPEN_APP"
    >
      <TextWidget text="ML" style={{ color:WC.gold, fontWeight:'bold', fontSize:22, letterSpacing:4 }}/>
      <TextWidget text="MOTOLINK" style={{ color:WC.gold, fontWeight:'bold', fontSize:13, letterSpacing:4, marginTop:4 }}/>
      <TextWidget text="Tap to open" style={{ color:WC.gray, fontSize:11, marginTop:8 }}/>
    </FlexWidget>
  );
}

// ══════════════════════════════════════════════
// WIDGET TASK HANDLER
// This runs when Android requests a widget update
// Register this in your index.js
// ══════════════════════════════════════════════
export function widgetTaskHandler(props) {
  const widgetInfo = props.widgetInfo;

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      // Fetch data and render appropriate widget
      getWidgetData().then(data => {
        let widget;

        if (!data) {
          widget = <LoadingWidget/>;
        } else if (widgetInfo.widgetName === 'PassengerWidget' || data.role === 'passenger') {
          widget = <PassengerWidget data={data}/>;
        } else {
          widget = <DriverWidget data={data}/>;
        }

        props.renderWidget(widget);
      }).catch(() => {
        props.renderWidget(<LoadingWidget/>);
      });
      break;
    }

    case 'WIDGET_DELETED':
      break;

    case 'WIDGET_CLICK': {
      // Widget tapped — open app
      // The clickAction="OPEN_APP" handles this automatically
      break;
    }

    default:
      props.renderWidget(<LoadingWidget/>);
  }
}

// ══════════════════════════════════════════════
// REGISTER (call this in your index.js)
// ══════════════════════════════════════════════
export function registerMotoLinkWidgets() {
  registerWidgetTaskHandler(widgetTaskHandler);
}

// ══════════════════════════════════════════════
// INDEX.JS SETUP INSTRUCTIONS
// Add these lines to your index.js:
//
// import { registerMotoLinkWidgets } from './MotoLinkWidget';
// registerMotoLinkWidgets();
//
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// APP.JSON ADDITIONS NEEDED:
// Under "plugins" array, add:
// [
//   "react-native-android-widget",
//   {
//     "widgetProviders": [
//       {
//         "name": "PassengerWidget",
//         "label": "MotoLink Passenger",
//         "description": "Active trip status & wallet balance",
//         "minWidth": "180dp",
//         "minHeight": "110dp",
//         "targetCellWidth": 3,
//         "targetCellHeight": 2,
//         "updatePeriodMillis": 1800000,
//         "previewImage": "./assets/icon.png"
//       },
//       {
//         "name": "DriverWidget",
//         "label": "MotoLink Driver",
//         "description": "Today's earnings & active job",
//         "minWidth": "180dp",
//         "minHeight": "110dp",
//         "targetCellWidth": 3,
//         "targetCellHeight": 2,
//         "updatePeriodMillis": 1800000,
//         "previewImage": "./assets/icon.png"
//       }
//     ]
//   }
// ]
// ══════════════════════════════════════════════

