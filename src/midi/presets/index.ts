/*
 * Copyright (c) 2026 Fabrizio Salmi. All rights reserved.
 * MIXI — PolyForm Noncommercial License 1.0.0.
 */

// ─────────────────────────────────────────────────────────────
// Mixi – MIDI Controller Preset Registry (45 controllers)
//
// CC numbers sourced from:
//   - Mixxx official XML/JS mappings (VERIFIED)
//   - Manufacturer MIDI protocol docs (VERIFIED)
//   - Community reverse-engineering (PARTIAL)
//
// Three main CC families:
//   Pioneer DDJ:  Vol=CC19, EQ=CC7/11/15, Gain=CC4, Pitch=CC0
//   InMusic:      Vol=CC28, EQ=CC23/24/25, Gain=CC22, Pitch=CC9
//   Hercules:     Vol=CC0, EQ=CC2/3/4, Gain=CC5, Pitch=CC8
// ─────────────────────────────────────────────────────────────

import type { MidiMapping } from '../MidiManager';

// ── Akai ────────────────────────────────────────────────────
import { AKAI_MIDI_MIX_PRESET } from './akaiMidiMix';
import { AKAI_APC40_MK2_PRESET } from './akaiApc40Mk2';

// ── Allen & Heath ───────────────────────────────────────────
import { ALLEN_HEATH_XONE_K2_PRESET } from './allenHeathXoneK2';

// ── Behringer ───────────────────────────────────────────────
import { BEHRINGER_CMD_STUDIO_4A_PRESET } from './behringerCmdStudio4a';
import { BEHRINGER_CMD_MM1_PRESET } from './behringerCmdMm1';

// ── Denon DJ ────────────────────────────────────────────────
import { DENON_MC4000_PRESET } from './denonMc4000';
import { DENON_MC6000_MK2_PRESET } from './denonMc6000Mk2';
import { DENON_MC7000_PRESET } from './denonMc7000';
import { DENON_PRIME_GO_PRESET } from './denonPrimeGo';
import { DENON_SC_LIVE_2_PRESET } from './denonScLive2';
import { DENON_SC_LIVE_4_PRESET } from './denonScLive4';

// ── Hercules ────────────────────────────────────────────────
import { HERCULES_INPULSE_200_PRESET } from './herculesInpulse200';
import { HERCULES_INPULSE_300_PRESET } from './herculesInpulse300';
import { HERCULES_INPULSE_500_PRESET } from './herculesInpulse500';
import { HERCULES_INPULSE_T7_PRESET } from './herculesInpulseT7';
import { HERCULES_STARLIGHT_PRESET } from './herculesStarlight';

// ── Native Instruments ──────────────────────────────────────
import { NI_KONTROL_S2_MK3_PRESET } from './niKontrolS2Mk3';
import { NI_KONTROL_S4_MK3_PRESET } from './niKontrolS4Mk3';
import { NI_KONTROL_X1_MK2_PRESET } from './niKontrolX1Mk2';
import { NI_KONTROL_F1_PRESET } from './niKontrolF1';
import { TRAKTOR_KONTROL_Z1_PRESET } from './traktorKontrolZ1';

// ── Numark ──────────────────────────────────────────────────
import { NUMARK_MIXTRACK_PRO_FX_PRESET } from './numarkMixtrackProFx';
import { NUMARK_MIXTRACK_PLATINUM_FX_PRESET } from './numarkMixtrackPlatinumFx';
import { NUMARK_MIXSTREAM_PRO_PRESET } from './numarkMixstreamPro';
import { NUMARK_DJ2GO2_TOUCH_PRESET } from './numarkDj2go2Touch';
import { NUMARK_PARTY_MIX_2_PRESET } from './numarkPartyMix2';
import { NUMARK_SCRATCH_PRESET } from './numarkScratch';
import { NUMARK_NS6II_PRESET } from './numarkNs6ii';

// ── Pioneer DJ ──────────────────────────────────────────────
import { PIONEER_DDJ_200_PRESET } from './pioneerDdj200';
import { PIONEER_DDJ_400_PRESET } from './pioneerDdj400';
import { PIONEER_DDJ_800_PRESET } from './pioneerDdj800';
import { PIONEER_DDJ_1000_PRESET } from './pioneerDdj1000';
import { PIONEER_DDJ_FLX4_PRESET } from './pioneerDdjFlx4';
import { PIONEER_DDJ_FLX6_PRESET } from './pioneerDdjFlx6';
import { PIONEER_DDJ_FLX10_PRESET } from './pioneerDdjFlx10';
import { PIONEER_DDJ_REV1_PRESET } from './pioneerDdjRev1';
import { PIONEER_DDJ_SB3_PRESET } from './pioneerDdjSb3';
import { PIONEER_DDJ_SX3_PRESET } from './pioneerDdjSx3';
import { PIONEER_XDJ_RX3_PRESET } from './pioneerXdjRx3';

// ── Reloop ──────────────────────────────────────────────────
import { RELOOP_BUDDY_PRESET } from './reloopBuddy';
import { RELOOP_READY_PRESET } from './reloopReady';
import { RELOOP_MIXON_4_PRESET } from './reloopMixon4';
import { RELOOP_TERMINAL_MIX_4_PRESET } from './reloopTerminalMix4';

// ── Roland ──────────────────────────────────────────────────
import { ROLAND_DJ_202_PRESET } from './rolandDj202';
import { ROLAND_DJ_505_PRESET } from './rolandDj505';

// ── Registry ────────────────────────────────────────────────

export interface PresetEntry {
  id: string;
  label: string;
  manufacturer: string;
  mappings: MidiMapping[];
}

export const MIDI_CONTROLLER_PRESETS: PresetEntry[] = [
  // Akai
  { id: 'akai-midimix',           label: 'Akai MIDI Mix',                manufacturer: 'Akai',               mappings: AKAI_MIDI_MIX_PRESET },
  { id: 'akai-apc40mk2',          label: 'Akai APC40 MK2',              manufacturer: 'Akai',               mappings: AKAI_APC40_MK2_PRESET },
  // Allen & Heath
  { id: 'ah-xone-k2',             label: 'Allen & Heath Xone:K2',       manufacturer: 'Allen & Heath',      mappings: ALLEN_HEATH_XONE_K2_PRESET },
  // Behringer
  { id: 'behringer-cmd-4a',       label: 'Behringer CMD Studio 4a',      manufacturer: 'Behringer',          mappings: BEHRINGER_CMD_STUDIO_4A_PRESET },
  { id: 'behringer-cmd-mm1',      label: 'Behringer CMD MM-1',           manufacturer: 'Behringer',          mappings: BEHRINGER_CMD_MM1_PRESET },
  // Denon DJ
  { id: 'denon-mc4000',           label: 'Denon MC4000',                 manufacturer: 'Denon DJ',           mappings: DENON_MC4000_PRESET },
  { id: 'denon-mc6000mk2',        label: 'Denon MC6000 MK2',            manufacturer: 'Denon DJ',           mappings: DENON_MC6000_MK2_PRESET },
  { id: 'denon-mc7000',           label: 'Denon MC7000',                 manufacturer: 'Denon DJ',           mappings: DENON_MC7000_PRESET },
  { id: 'denon-prime-go',         label: 'Denon Prime GO',               manufacturer: 'Denon DJ',           mappings: DENON_PRIME_GO_PRESET },
  { id: 'denon-sc-live-2',        label: 'Denon SC Live 2',              manufacturer: 'Denon DJ',           mappings: DENON_SC_LIVE_2_PRESET },
  { id: 'denon-sc-live-4',        label: 'Denon SC Live 4',              manufacturer: 'Denon DJ',           mappings: DENON_SC_LIVE_4_PRESET },
  // Hercules
  { id: 'hercules-inpulse200',    label: 'Hercules Inpulse 200',        manufacturer: 'Hercules',           mappings: HERCULES_INPULSE_200_PRESET },
  { id: 'hercules-inpulse300',    label: 'Hercules Inpulse 300',        manufacturer: 'Hercules',           mappings: HERCULES_INPULSE_300_PRESET },
  { id: 'hercules-inpulse500',    label: 'Hercules Inpulse 500',        manufacturer: 'Hercules',           mappings: HERCULES_INPULSE_500_PRESET },
  { id: 'hercules-inpulse-t7',    label: 'Hercules Inpulse T7',         manufacturer: 'Hercules',           mappings: HERCULES_INPULSE_T7_PRESET },
  { id: 'hercules-starlight',     label: 'Hercules Starlight',          manufacturer: 'Hercules',           mappings: HERCULES_STARLIGHT_PRESET },
  // Native Instruments
  { id: 'ni-kontrol-f1',          label: 'Kontrol F1',                  manufacturer: 'Native Instruments', mappings: NI_KONTROL_F1_PRESET },
  { id: 'ni-kontrol-s2-mk3',      label: 'Kontrol S2 MK3 (MIDI)',       manufacturer: 'Native Instruments', mappings: NI_KONTROL_S2_MK3_PRESET },
  { id: 'ni-kontrol-s4-mk3',      label: 'Kontrol S4 MK3 (MIDI)',       manufacturer: 'Native Instruments', mappings: NI_KONTROL_S4_MK3_PRESET },
  { id: 'ni-kontrol-x1-mk2',      label: 'Kontrol X1 MK2',              manufacturer: 'Native Instruments', mappings: NI_KONTROL_X1_MK2_PRESET },
  { id: 'traktor-kontrol-z1',     label: 'Traktor Kontrol Z1 (MIDI)',    manufacturer: 'Native Instruments', mappings: TRAKTOR_KONTROL_Z1_PRESET },
  // Numark
  { id: 'numark-dj2go2-touch',    label: 'Numark DJ2GO2 Touch',         manufacturer: 'Numark',             mappings: NUMARK_DJ2GO2_TOUCH_PRESET },
  { id: 'numark-mixstream-pro',   label: 'Numark Mixstream Pro',         manufacturer: 'Numark',             mappings: NUMARK_MIXSTREAM_PRO_PRESET },
  { id: 'numark-mixtrack-pfx',    label: 'Numark Mixtrack Pro FX',      manufacturer: 'Numark',             mappings: NUMARK_MIXTRACK_PRO_FX_PRESET },
  { id: 'numark-mixtrack-platfx', label: 'Numark Mixtrack Platinum FX', manufacturer: 'Numark',             mappings: NUMARK_MIXTRACK_PLATINUM_FX_PRESET },
  { id: 'numark-ns6ii',           label: 'Numark NS6II',                manufacturer: 'Numark',             mappings: NUMARK_NS6II_PRESET },
  { id: 'numark-party-mix-2',     label: 'Numark Party Mix II',         manufacturer: 'Numark',             mappings: NUMARK_PARTY_MIX_2_PRESET },
  { id: 'numark-scratch',         label: 'Numark Scratch',              manufacturer: 'Numark',             mappings: NUMARK_SCRATCH_PRESET },
  // Pioneer DJ
  { id: 'pioneer-ddj-200',        label: 'Pioneer DDJ-200',             manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_200_PRESET },
  { id: 'pioneer-ddj-400',        label: 'Pioneer DDJ-400',             manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_400_PRESET },
  { id: 'pioneer-ddj-800',        label: 'Pioneer DDJ-800',             manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_800_PRESET },
  { id: 'pioneer-ddj-1000',       label: 'Pioneer DDJ-1000',            manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_1000_PRESET },
  { id: 'pioneer-ddj-flx4',       label: 'Pioneer DDJ-FLX4',            manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_FLX4_PRESET },
  { id: 'pioneer-ddj-flx6',       label: 'Pioneer DDJ-FLX6',            manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_FLX6_PRESET },
  { id: 'pioneer-ddj-flx10',      label: 'Pioneer DDJ-FLX10',           manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_FLX10_PRESET },
  { id: 'pioneer-ddj-rev1',       label: 'Pioneer DDJ-REV1',            manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_REV1_PRESET },
  { id: 'pioneer-ddj-sb3',        label: 'Pioneer DDJ-SB3',             manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_SB3_PRESET },
  { id: 'pioneer-ddj-sx3',        label: 'Pioneer DDJ-SX3',             manufacturer: 'Pioneer DJ',         mappings: PIONEER_DDJ_SX3_PRESET },
  { id: 'pioneer-xdj-rx3',        label: 'Pioneer XDJ-RX3',             manufacturer: 'Pioneer DJ',         mappings: PIONEER_XDJ_RX3_PRESET },
  // Reloop
  { id: 'reloop-buddy',           label: 'Reloop Buddy',                manufacturer: 'Reloop',             mappings: RELOOP_BUDDY_PRESET },
  { id: 'reloop-mixon-4',         label: 'Reloop Mixon 4',              manufacturer: 'Reloop',             mappings: RELOOP_MIXON_4_PRESET },
  { id: 'reloop-ready',           label: 'Reloop Ready',                manufacturer: 'Reloop',             mappings: RELOOP_READY_PRESET },
  { id: 'reloop-terminal-mix4',   label: 'Reloop Terminal Mix 4',        manufacturer: 'Reloop',             mappings: RELOOP_TERMINAL_MIX_4_PRESET },
  // Roland
  { id: 'roland-dj-202',          label: 'Roland DJ-202',               manufacturer: 'Roland',             mappings: ROLAND_DJ_202_PRESET },
  { id: 'roland-dj-505',          label: 'Roland DJ-505',               manufacturer: 'Roland',             mappings: ROLAND_DJ_505_PRESET },
];
