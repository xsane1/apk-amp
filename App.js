import React, { useState, useEffect, useCallback } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  StatusBar,
  Linking,
  Share,
} from "react-native";

import { T, PLATE_RATINGS, CABLE_SIZES, COPPER_RESISTIVITY } from "./src/translations";
import { Storage } from "./src/storage";

// =====================================================================
// COLORS — mirrors the web app's CSS custom properties (style.css)
// =====================================================================
const C = {
  bg: "#020617",
  card: "#0f172a",
  cardSoft: "rgba(15,23,42,0.6)",
  border: "#1e293b",
  amber: "#fbbf24",
  green: "#34d399",
  red: "#f87171",
  text: "#ffffff",
  muted: "#94a3b8",
};

const IMPEDANCE_OPTIONS = [2, 4, 6, 8, 16];

// =====================================================================
// CALCULATORS — pure functions, no UI. Same formulas as the web app's
// app.js (calcOhm/calcAmp/calcTop) — keep both in sync if either changes.
// =====================================================================
function getLoadStatus(total, t) {
  if (total < 2) return { type: "danger", msg: t.safeDanger };
  if (total < 4) return { type: "warn", msg: t.safeWarn };
  if (total > 16) return { type: "warn", msg: t.safeHigh };
  return { type: "good", msg: t.safeGood };
}

function calcOhmResult(impedance, qty, conn) {
  const total =
    conn === "parallel"
      ? Math.round((impedance / qty) * 100) / 100
      : impedance * qty;
  return { total };
}

function calcAmpResult(rms, qty, impedance, conn) {
  const finalLoad =
    conn === "series"
      ? impedance * qty
      : Math.round((impedance / qty) * 100) / 100;
  const totalRms = rms * qty;
  return {
    finalLoad,
    min: Math.round(totalRms),
    ideal: Math.round(totalRms * 1.5),
    max: Math.round(totalRms * 2),
  };
}

function calcTopResult(lf1Watt, lf2Watt, hfWatt) {
  // Fixed cabinet config: 1 top = 2 LF + 1 HF (no quantity input).
  const cabinetPower = lf1Watt + lf2Watt + hfWatt;
  const target = cabinetPower * 1.2;
  const plate = PLATE_RATINGS.find((p) => p >= target) || null;
  return {
    lf1Watt,
    lf2Watt,
    hfWatt,
    cabinetPower,
    plate,
    min: Math.round(cabinetPower),
    ideal: Math.round(cabinetPower * 1.5),
    max: Math.round(cabinetPower * 2),
  };
}

// DMX Address Calculator: each fixture's start address is offset from
// the previous one by "channels per fixture". Flags the setup if it
// runs past the 512-channel DMX universe limit.
function calcDmxResult(channels, fixtures, startAddr) {
  const addresses = [];
  for (let i = 0; i < fixtures; i++) {
    addresses.push(startAddr + i * channels);
  }
  const lastEnd = startAddr + fixtures * channels - 1;
  return { addresses, overLimit: lastEnd > 512, lastEnd };
}

// Speaker Cable Loss Calculator: models the cable as a series
// resistance in a voltage divider with the speaker's nominal
// impedance. dB loss = 20·log10(Z / (Z + Rcable)); Rcable is the
// round-trip resistance for a given copper cross-section. Status
// tiers are a practical rule of thumb, not a hard spec.
function calcCableResult(power, impedance, length) {
  const results = CABLE_SIZES.map((size) => {
    const rCable = (2 * length * COPPER_RESISTIVITY) / size;
    const dB = Math.abs(20 * Math.log10(impedance / (impedance + rCable)));
    let statusKey, emoji;
    if (dB < 0.5) { statusKey = "statusExcellent"; emoji = "🟢"; }
    else if (dB < 1.5) { statusKey = "statusGood"; emoji = "🟢"; }
    else if (dB < 3) { statusKey = "statusAcceptable"; emoji = "🟡"; }
    else { statusKey = "statusHighLoss"; emoji = "🔴"; }
    return { size, dB, statusKey, emoji };
  });

  const recommended =
    results.find((r) => r.statusKey === "statusExcellent" || r.statusKey === "statusGood") ||
    results.reduce((best, r) => (r.dB < best.dB ? r : best));
  const best = results.reduce((b, r) => (r.dB < b.dB ? r : b));
  const current = Math.round(Math.sqrt(power / impedance) * 100) / 100;

  return { results, recommended, best, current };
}

const statusColor = (type) =>
  type === "good" ? C.green : type === "danger" ? C.red : "#fcd34d";

// =====================================================================
// SHARED UI PIECES
// =====================================================================
function LangToggle({ lang, setLang }) {
  return (
    <View style={styles.langWrap}>
      <TouchableOpacity
        onPress={() => setLang("en")}
        style={[styles.langBtn, lang === "en" && styles.langBtnActive]}
      >
        <Text style={[styles.langBtnText, lang === "en" && styles.langBtnTextActive]}>English</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setLang("hi")}
        style={[styles.langBtn, lang === "hi" && styles.langBtnActive]}
      >
        <Text style={[styles.langBtnText, lang === "hi" && styles.langBtnTextActive]}>हिंदी</Text>
      </TouchableOpacity>
    </View>
  );
}

function Header({ title, sub, onBack }) {
  return (
    <View style={styles.headerRow}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Text style={{ color: C.text, fontSize: 18 }}>‹</Text>
      </TouchableOpacity>
      <View>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerSub}>{sub}</Text>
      </View>
    </View>
  );
}

// step is optional so every existing caller (Ohm/Amp qty, DMX
// fixtures) keeps incrementing by 1 as before. Only Top Speaker's LF
// count passes step={2} explicitly (2 LF per cabinet) — this shared
// component's default behavior is unchanged for everyone else.
function Stepper({ value, onChange, min = 1, max = 20, step = 1 }) {
  return (
    <View style={styles.stepper}>
      <TouchableOpacity style={styles.stepperBtn} onPress={() => onChange(Math.max(min, value - step))}>
        <Text style={styles.stepperBtnText}>−</Text>
      </TouchableOpacity>
      <Text style={styles.stepperVal}>{value}</Text>
      <TouchableOpacity style={styles.stepperBtn} onPress={() => onChange(Math.min(max, value + step))}>
        <Text style={styles.stepperBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function ImpedanceChips({ value, onChange }) {
  return (
    <View style={styles.chipsRow}>
      {IMPEDANCE_OPTIONS.map((imp) => (
        <TouchableOpacity
          key={imp}
          style={[styles.chip, value === imp && styles.chipActive]}
          onPress={() => onChange(imp)}
        >
          <Text style={[styles.chipText, value === imp && styles.chipTextActive]}>{imp}Ω</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ConnToggle({ value, onChange, t }) {
  return (
    <View style={styles.connGrid}>
      <TouchableOpacity
        style={[styles.connBtn, value === "parallel" && styles.connBtnActive]}
        onPress={() => onChange("parallel")}
      >
        <Text style={styles.connGlyph}>⧉⧉</Text>
        <Text style={[styles.connText, value === "parallel" && styles.connTextActive]}>{t.parallel}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.connBtn, value === "series" && styles.connBtnActive]}
        onPress={() => onChange("series")}
      >
        <Text style={styles.connGlyph}>⊢⊣⊢⊣</Text>
        <Text style={[styles.connText, value === "series" && styles.connTextActive]}>{t.series}</Text>
      </TouchableOpacity>
    </View>
  );
}

function StatusPill({ type, msg }) {
  const color = statusColor(type);
  return (
    <View style={[styles.statusPill, { borderColor: color, backgroundColor: color + "1a" }]}>
      <Text style={[styles.statusPillText, { color }]}>
        {type === "good" ? "✓ " : "⚠ "}
        {msg}
      </Text>
    </View>
  );
}

// Small inline banner (list/result screens) — real ad in production,
// Google's test creative during development (__DEV__).
function AdBanner() {
  return (
    <View style={styles.adWrap}>
</View>
  );
}

// Bigger banner shown below a calculation result — see app.js's
// .ad-banner-large for the equivalent placeholder on the web build.
function AdBannerLarge() {
  return (
    <View style={styles.adWrapLarge}>
</View>
  );
}

function BottomNav({ screen, setScreen, t }) {
  return (
    <View style={styles.bottomNav}>
      <TouchableOpacity style={styles.navItem} onPress={() => setScreen("home")}>
        <Text style={[styles.navItemText, screen === "home" && { color: C.amber }]}>🏠 {t.homeNav}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.navItem} onPress={() => setScreen("info")}>
        <Text style={[styles.navItemText, screen === "info" && { color: C.amber }]}>ℹ️ {t.infoNav}</Text>
      </TouchableOpacity>
    </View>
  );
}

function InfoBox({ title, children, amber }) {
  return (
    <View style={[styles.infoBox, amber && styles.infoBoxAmber]}>
      {title ? <Text style={[styles.infoBoxTitle, amber && { color: C.amber }]}>{title}</Text> : null}
      <Text style={styles.infoBoxText}>{children}</Text>
    </View>
  );
}

function ActionRow({ onReset, t, shareText }) {
  const onShare = () => {
    Share.share({ message: shareText || "AmpOhm" }).catch(() => {
      // user cancelled the share sheet — not an error, do nothing
    });
  };
  return (
    <View style={styles.actionRow}>
      <TouchableOpacity style={styles.actionBtn} onPress={onReset}>
        <Text style={styles.actionBtnText}>↺ {t.reset}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.actionBtn} onPress={onShare}>
        <Text style={styles.actionBtnText}>⇪ {t.share}</Text>
      </TouchableOpacity>
    </View>
  );
}

// =====================================================================
// APP
// =====================================================================
export default function App() {
  const [lang, setLangState] = useState("en"); // English by default; restored below if a preference was saved
  const [screen, setScreen] = useState("home");
  const t = T[lang];

  // ---- Ohm Calculator state ----
  const [ohmQty, setOhmQty] = useState(2);
  const [ohmImpedance, setOhmImpedance] = useState(8);
  const [ohmConn, setOhmConn] = useState("parallel");
  const [ohmResult, setOhmResult] = useState(null);

  // ---- Amplifier Calculator state ----
  const [ampRms, setAmpRms] = useState("300");
  const [ampQty, setAmpQty] = useState(1);
  const [ampImpedance, setAmpImpedance] = useState(8);
  const [ampConn, setAmpConn] = useState("parallel");
  const [ampResult, setAmpResult] = useState(null);

  // ---- Top Speaker Calculator state ----
  const [topLf1Watt, setTopLf1Watt] = useState("400");
  const [topLf2Watt, setTopLf2Watt] = useState("400");
  const [topHfWatt, setTopHfWatt] = useState("100");
  const [topResult, setTopResult] = useState(null);

  // ---- DMX Address Calculator state ----
  const [dmxChannels, setDmxChannels] = useState("16");
  const [dmxFixtures, setDmxFixtures] = useState("4");
  const [dmxStart, setDmxStart] = useState("1");
  const [dmxResult, setDmxResult] = useState(null);
  const [dmxError, setDmxError] = useState(false);
  const [topError, setTopError] = useState(false);
  const [ampError, setAmpError] = useState(false);
  // Field-work progress tracker — which specific fixtures (by index) a
  // technician has physically addressed so far, tap-to-toggle any order.
  // Independent of the address list above.
  const [dmxFlags, setDmxFlags] = useState([]);

  // ---- Speaker Cable Loss Calculator state ----
  const [cablePower, setCablePower] = useState("500");
  const [cableImpedance, setCableImpedance] = useState(8);
  const [cableLength, setCableLength] = useState("20");
  const [cableResult, setCableResult] = useState(null);

  // ---- Info screen state ----
  const [infoDetailIndex, setInfoDetailIndex] = useState(null);

  // Init: AdMob SDK + restore saved language preference
  useEffect(() => {
    (async () => {
      const saved = await Storage.getLanguage();
      if (saved) setLangState(saved);
    })();
  }, []);

  const setLang = useCallback((l) => {
    setLangState(l);
    Storage.setLanguage(l); // persist for next launch
  }, []);

  const goHome = (resetFn) => {
    if (resetFn) resetFn();
    setScreen("home");
  };

  // ---- Screen: HOME ----
  const renderHome = () => (
    <ScrollView contentContainerStyle={styles.screenPad}>
      <TouchableOpacity style={styles.topLangPill} onPress={() => setLang(lang === "hi" ? "en" : "hi")}>
        <Text style={styles.topLangPillText}>🌐 {lang === "hi" ? "हिंदी" : "English"} ▾</Text>
      </TouchableOpacity>

      <View style={styles.brand}>
        <Text style={styles.brandText}>
          Amp<Text style={{ color: C.amber }}>Ohm</Text>
        </Text>
        <Text style={styles.tagline}>{t.tagline}</Text>
      </View>

      <TouchableOpacity style={styles.cardBtn} onPress={() => setScreen("ohm")}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconCircleText}>Ω</Text>
        </View>
        <View>
          <Text style={styles.cardTitle}>{t.ohmTitle}</Text>
          <Text style={styles.cardSub}>{t.ohmSub}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cardBtn} onPress={() => setScreen("amp")}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconCircleText}>⚡</Text>
        </View>
        <View>
          <Text style={styles.cardTitle}>{t.ampTitle}</Text>
          <Text style={styles.cardSub}>{t.ampSub}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cardBtn} onPress={() => setScreen("top")}>
        <View style={styles.iconCircle}>
          <Text style={[styles.iconCircleText, { fontSize: 13 }]}>2+1</Text>
        </View>
        <View>
          <Text style={styles.cardTitle}>{t.topTitle}</Text>
          <Text style={styles.cardSub}>{t.topSub}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cardBtn} onPress={() => setScreen("dmx")}>
        <View style={styles.iconCircle}>
          <Text style={[styles.iconCircleText, { fontSize: 11 }]}>DMX</Text>
        </View>
        <View>
          <Text style={styles.cardTitle}>{t.dmxTitle}</Text>
          <Text style={styles.cardSub}>{t.dmxSub}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.cardBtn} onPress={() => setScreen("cable")}>
        <View style={styles.iconCircle}>
          <Text style={[styles.iconCircleText, { fontSize: 18 }]}>〰</Text>
        </View>
        <View>
          <Text style={styles.cardTitle}>{t.cableTitle}</Text>
          <Text style={styles.cardSub}>{t.cableSub}</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.soonBox}>
        <Text style={styles.soonLabel}>{t.comingSoon}</Text>
        {t.comingList.map((c) => (
          <Text key={c} style={styles.soonItem}>{c}</Text>
        ))}
      </View>

      <AdBanner />
      <BottomNav screen={screen} setScreen={setScreen} t={t} />
    </ScrollView>
  );

  // ---- Screen: OHM CALCULATOR ----
  const resetOhm = () => setOhmResult(null);
  const calcOhm = () => setOhmResult(calcOhmResult(ohmImpedance, ohmQty, ohmConn));

  const renderOhm = () => {
    const status = ohmResult ? getLoadStatus(ohmResult.total, t) : null;
    const understand = ohmConn === "parallel" ? t.understandParallel : t.understandSeries;
    return (
      <ScrollView contentContainerStyle={styles.screenPad}>
        <Header title={t.ohmTitle} sub={t.ohmSub} onBack={() => goHome(resetOhm)} />
        <LangToggle lang={lang} setLang={setLang} />

        {!ohmResult ? (
          <View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.step1Ohm}</Text>
              <Stepper value={ohmQty} onChange={setOhmQty} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.step2Ohm}</Text>
              <ImpedanceChips value={ohmImpedance} onChange={setOhmImpedance} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.step3Ohm}</Text>
              <ConnToggle value={ohmConn} onChange={setOhmConn} t={t} />
            </View>
            <TouchableOpacity style={styles.calcBtn} onPress={calcOhm}>
              <Text style={styles.calcBtnText}>{t.calculate}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.resultTitle}>{t.resultTitle}</Text>
            <View style={styles.resultBox}>
              <Text style={styles.resultLbl}>{t.totalLoad}</Text>
              <Text style={styles.resultBig}>{ohmResult.total}Ω</Text>
              <StatusPill type={status.type} msg={status.msg} />
            </View>
            <InfoBox title={t.detailsTitle}>{understand}</InfoBox>
            <InfoBox title={t.understandTitle} amber>{understand}</InfoBox>
            <ActionRow onReset={resetOhm} t={t} shareText={'AmpOhm — ' + t.ohmTitle + '\n' + t.totalLoad + ': ' + ohmResult.total + 'Ω\n' + status.msg} />
            <AdBannerLarge />
          </View>
        )}
        <AdBanner />
      </ScrollView>
    );
  };

  // ---- Screen: AMPLIFIER CALCULATOR ----
  const resetAmp = () => { setAmpResult(null); setAmpError(false); };
  const calcAmp = () => {
    if (Number(ampRms) <= 0 || ampRms === "") {
      setAmpError(true);
      return; // don't calculate until fixed
    }
    setAmpError(false);
    const rms = Number(ampRms) || 0;
    setAmpResult(calcAmpResult(rms, ampQty, ampImpedance, ampConn));
  };

  const renderAmp = () => {
    // Extreme-low-impedance warning is Amp-only (per review), so it's
    // layered on top of the shared getLoadStatus() result here rather
    // than changing that shared function (which Ohm also uses).
    let status = ampResult ? getLoadStatus(ampResult.finalLoad, t) : null;
    if (ampResult && ampResult.finalLoad < 1) {
      status = { type: "danger", msg: t.safeExtreme };
    }
    return (
      <ScrollView contentContainerStyle={styles.screenPad}>
        <Header title={t.ampTitle} sub={t.ampSub} onBack={() => goHome(resetAmp)} />
        <LangToggle lang={lang} setLang={setLang} />

        {!ampResult ? (
          <View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.step1Amp}</Text>
              <View style={styles.rmsWrap}>
                <TextInput
                  style={styles.rmsInput}
                  keyboardType="numeric"
                  value={ampRms}
                  onChangeText={setAmpRms}
                />
                <Text style={styles.rmsUnit}>{t.watt}</Text>
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.step2Amp}</Text>
              <Stepper value={ampQty} onChange={setAmpQty} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.step3Amp}</Text>
              <ImpedanceChips value={ampImpedance} onChange={setAmpImpedance} />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t.step4Amp}</Text>
              <ConnToggle value={ampConn} onChange={setAmpConn} t={t} />
              <Text style={styles.fieldHint}>
                {ampConn === "parallel" ? t.hintParallel : t.hintSeries}
              </Text>
            </View>
            <TouchableOpacity style={styles.calcBtn} onPress={calcAmp}>
              <Text style={styles.calcBtnText}>{t.calculate}</Text>
            </TouchableOpacity>
            {ampError && <InfoBox title={"⚠️ " + t.caution} amber>{t.ampPowerError}</InfoBox>}
            <InfoBox>{t.ampNote}</InfoBox>
          </View>
        ) : (
          <View>
            <View style={styles.resultBox}>
              <Text style={styles.resultLbl}>{t.totalLoad}</Text>
              <Text style={[styles.resultBig, { fontSize: 34 }]}>{ampResult.finalLoad}Ω</Text>
              <StatusPill type={status.type} msg={status.msg} />
            </View>
            <Text style={styles.resultTitleLeft}>{t.suggestedAmp}</Text>
            <View style={styles.ampRow}>
              <Text style={styles.ampRowLbl}>{t.minLabel}</Text>
              <Text style={styles.ampRowVal}>{ampResult.min}W @ {ampResult.finalLoad}Ω</Text>
            </View>
            <View style={[styles.ampRow, styles.ampRowIdeal]}>
              <Text style={styles.ampRowLbl}>{t.idealLabel}</Text>
              <Text style={[styles.ampRowVal, { color: C.green }]}>{ampResult.ideal}W @ {ampResult.finalLoad}Ω</Text>
            </View>
            <View style={styles.ampRow}>
              <Text style={styles.ampRowLbl}>{t.maxLabel}</Text>
              <Text style={[styles.ampRowVal, { color: C.red }]}>{ampResult.max}W @ {ampResult.finalLoad}Ω</Text>
            </View>
            <InfoBox title={t.impedanceNoteTitle}>
              {t.impedanceNoteText.replace("{ohm}", ampResult.finalLoad)}
            </InfoBox>
            <InfoBox title={"⚠️ " + t.caution} amber>{t.cautionText}</InfoBox>
            <ActionRow onReset={resetAmp} t={t} shareText={'AmpOhm — ' + t.ampTitle + '\n' + t.totalLoad + ': ' + ampResult.finalLoad + 'Ω\n' + t.idealLabel + ': ' + ampResult.ideal + 'W @ ' + ampResult.finalLoad + 'Ω'} />
            <AdBannerLarge />
          </View>
        )}
        <AdBanner />
      </ScrollView>
    );
  };

  // ---- Screen: TOP SPEAKER CALCULATOR ----
  const resetTop = () => { setTopResult(null); setTopError(false); };
  const calcTop = () => {
    if (Number(topLf1Watt) < 200 || topLf1Watt === "" || Number(topLf2Watt) < 200 || topLf2Watt === "" || Number(topHfWatt) < 50 || topHfWatt === "") {
      setTopError(true);
      return; // don't calculate until fixed
    }
    setTopError(false);
    const lf1Watt = Number(topLf1Watt) || 0;
    const lf2Watt = Number(topLf2Watt) || 0;
    const hfWatt = Number(topHfWatt) || 0;
    setTopResult(calcTopResult(lf1Watt, lf2Watt, hfWatt));
  };

  const renderTop = () => (
    <ScrollView contentContainerStyle={styles.screenPad}>
      <Header title={t.topTitle} sub={t.topSub} onBack={() => goHome(resetTop)} />
      <LangToggle lang={lang} setLang={setLang} />

      {!topResult ? (
        <View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step1Top}</Text>
            <View style={styles.rmsWrap}>
              <TextInput
                style={styles.rmsInput}
                keyboardType="numeric"
                value={topLf1Watt}
                onChangeText={setTopLf1Watt}
              />
              <Text style={styles.rmsUnit}>{t.watt}</Text>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step2Top}</Text>
            <View style={styles.rmsWrap}>
              <TextInput
                style={styles.rmsInput}
                keyboardType="numeric"
                value={topLf2Watt}
                onChangeText={setTopLf2Watt}
              />
              <Text style={styles.rmsUnit}>{t.watt}</Text>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step3Top}</Text>
            <View style={styles.rmsWrap}>
              <TextInput
                style={styles.rmsInput}
                keyboardType="numeric"
                value={topHfWatt}
                onChangeText={setTopHfWatt}
              />
              <Text style={styles.rmsUnit}>{t.watt}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.calcBtn} onPress={calcTop}>
            <Text style={styles.calcBtnText}>{t.calculate}</Text>
          </TouchableOpacity>
          {topError && <InfoBox title={"⚠️ " + t.caution} amber>{t.topPowerError}</InfoBox>}
          <InfoBox>{t.plateNote}</InfoBox>
        </View>
      ) : (
        <View>
          <Text style={styles.resultTitleLeft}>{t.cabinetCalcTitle}</Text>
          <View style={styles.ampRow}>
            <Text style={styles.ampRowLbl}>{t.lf1Label}</Text>
            <Text style={styles.ampRowVal}>{topResult.lf1Watt}W</Text>
          </View>
          <View style={styles.ampRow}>
            <Text style={styles.ampRowLbl}>{t.lf2Label}</Text>
            <Text style={styles.ampRowVal}>{topResult.lf2Watt}W</Text>
          </View>
          <View style={styles.ampRow}>
            <Text style={styles.ampRowLbl}>{t.hfDriverLabel}</Text>
            <Text style={styles.ampRowVal}>{topResult.hfWatt}W</Text>
          </View>
          <View style={[styles.ampRow, styles.ampRowIdeal]}>
            <Text style={styles.ampRowLbl}>{t.totalCabinetPowerLabel}</Text>
            <Text style={[styles.ampRowVal, { color: C.green }]}>{topResult.cabinetPower}W RMS</Text>
          </View>
          <View style={styles.ampRow}>
            <Text style={styles.ampRowLbl}>{t.suggestedPlateLabel}</Text>
            <Text style={styles.ampRowVal}>{topResult.plate ? topResult.plate + "W" : t.plateCustomText}</Text>
          </View>

          <Text style={styles.resultTitleLeft}>{t.suggestedAmpForTop}</Text>
          <View style={styles.ampRow}>
            <Text style={styles.ampRowLbl}>{t.minLabel}</Text>
            <Text style={styles.ampRowVal}>{topResult.min}W</Text>
          </View>
          <View style={[styles.ampRow, styles.ampRowIdeal]}>
            <Text style={styles.ampRowLbl}>{t.idealLabel}</Text>
            <Text style={[styles.ampRowVal, { color: C.green }]}>{topResult.ideal}W</Text>
          </View>
          <View style={styles.ampRow}>
            <Text style={styles.ampRowLbl}>{t.maxLabel}</Text>
            <Text style={[styles.ampRowVal, { color: C.red }]}>{topResult.max}W</Text>
          </View>

          <InfoBox title={"⚠️ " + t.caution} amber>{t.cautionText}</InfoBox>
          <ActionRow onReset={resetTop} t={t} shareText={'AmpOhm — ' + t.topTitle + '\n' + t.lf1Label + ': ' + topResult.lf1Watt + 'W\n' + t.lf2Label + ': ' + topResult.lf2Watt + 'W\n' + t.hfDriverLabel + ': ' + topResult.hfWatt + 'W\n' + t.totalCabinetPowerLabel + ': ' + topResult.cabinetPower + 'W RMS\n' + t.suggestedPlateLabel + ': ' + (topResult.plate ? topResult.plate + 'W' : t.plateCustomText)} />
          <AdBannerLarge />
        </View>
      )}
      <AdBanner />
    </ScrollView>
  );

  // ---- Screen: DMX ADDRESS CALCULATOR ----
  const resetDmx = () => { setDmxResult(null); setDmxError(false); };
  const calcDmx = () => {
    if (Number(dmxChannels) <= 0 || dmxChannels === "" || Number(dmxFixtures) <= 0 || dmxFixtures === "") {
      setDmxError(true);
      return; // don't calculate until fixed
    }
    setDmxError(false);
    const channels = Math.max(1, Number(dmxChannels) || 1);
    const start = Math.max(1, Number(dmxStart) || 1);
    const fixtures = Math.max(1, Number(dmxFixtures) || 1);
    setDmxResult(calcDmxResult(channels, fixtures, start));

    // Field-work progress: resume if the saved progress was for the
    // same total fixture count (likely the same job), else start fresh.
    Storage.getDmxProgress().then((saved) => {
      const restored = saved && saved.total === fixtures && Array.isArray(saved.flags) && saved.flags.length === fixtures
        ? saved.flags
        : new Array(fixtures).fill(false);
      setDmxFlags(restored);
    });
  };

  // Tapping a fixture directly flips just that one — lets a technician
  // work out of order, not just sequentially.
  const toggleDmxFixture = (i) => {
    const total = dmxResult ? dmxResult.addresses.length : 0;
    setDmxFlags((prev) => {
      const next = prev.slice();
      next[i] = !next[i];
      Storage.setDmxProgress(next, total);
      return next;
    });
  };

  // The +/- buttons are a quick sequential adjust: "+" marks the next
  // not-yet-done fixture, "−" unmarks the most recently done one.
  const adjustDmxProgress = (delta) => {
    const total = dmxResult ? dmxResult.addresses.length : 0;
    setDmxFlags((prev) => {
      const next = prev.slice();
      if (delta > 0) {
        const idx = next.indexOf(false);
        if (idx !== -1) next[idx] = true;
      } else {
        const idx = next.lastIndexOf(true);
        if (idx !== -1) next[idx] = false;
      }
      Storage.setDmxProgress(next, total);
      return next;
    });
  };

  const renderDmx = () => {
    const dmxConfigured = dmxFlags.filter(Boolean).length;
    const dmxTotal = dmxResult ? dmxResult.addresses.length : 0;
    const dmxPct = dmxTotal > 0 ? Math.round((dmxConfigured / dmxTotal) * 100) : 0;
    return (
    <ScrollView contentContainerStyle={styles.screenPad}>
      <Header title={t.dmxTitle} sub={t.dmxSub} onBack={() => goHome(resetDmx)} />
      <LangToggle lang={lang} setLang={setLang} />

      {!dmxResult ? (
        <View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step1Dmx}</Text>
            <View style={styles.rmsWrap}>
              <TextInput
                style={styles.rmsInput}
                keyboardType="numeric"
                value={dmxChannels}
                onChangeText={setDmxChannels}
              />
              <Text style={styles.rmsUnit}>{t.channelsUnit}</Text>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step2Dmx}</Text>
            <View style={styles.rmsWrap}>
              <TextInput
                style={styles.rmsInput}
                keyboardType="numeric"
                value={dmxFixtures}
                onChangeText={setDmxFixtures}
              />
              <Text style={styles.rmsUnit}>{t.fixturesUnit}</Text>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step3Dmx}</Text>
            <View style={styles.rmsWrap}>
              <TextInput
                style={styles.rmsInput}
                keyboardType="numeric"
                value={dmxStart}
                onChangeText={setDmxStart}
              />
              <Text style={styles.rmsUnit}>{t.addressUnit}</Text>
            </View>
          </View>
          {dmxError && (
            <InfoBox title={"⚠️ " + t.caution} amber>{t.dmxChannelsError}</InfoBox>
          )}
          <TouchableOpacity style={styles.calcBtn} onPress={calcDmx}>
            <Text style={styles.calcBtnText}>{t.calculate}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <View style={[styles.infoBox, { marginBottom: 16 }]}>
            <Text style={[styles.infoBoxTitle, { textAlign: "center", marginBottom: 10 }]}>{t.dmxProgressTitle}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 }}>
              <TouchableOpacity style={[styles.actionBtn, { flex: 0, paddingHorizontal: 18 }]} onPress={() => adjustDmxProgress(-1)}>
                <Text style={[styles.actionBtnText, { fontSize: 18 }]}>−</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 20, fontWeight: "800", color: C.text, minWidth: 80, textAlign: "center" }}>
                {dmxConfigured} / {dmxTotal}
              </Text>
              <TouchableOpacity style={[styles.actionBtn, { flex: 0, paddingHorizontal: 18 }]} onPress={() => adjustDmxProgress(1)}>
                <Text style={[styles.actionBtnText, { fontSize: 18 }]}>+</Text>
              </TouchableOpacity>
            </View>
            <View style={{ backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, height: 8, overflow: "hidden", marginTop: 14 }}>
              <View style={{ backgroundColor: C.amber, height: "100%", borderRadius: 999, width: dmxPct + "%" }} />
            </View>
            <Text style={{ textAlign: "center", fontSize: 12, color: C.muted, marginTop: 8 }}>
              {t.dmxProgressPercent.replace("{p}", dmxPct)}
            </Text>
          </View>
          <Text style={styles.resultTitleLeft}>{t.dmxResultTitle}</Text>
          <Text style={{ color: C.muted, fontSize: 11, marginTop: -4, marginBottom: 10 }}>{t.dmxTapHint}</Text>
          <View style={styles.dmxGrid}>
            {dmxResult.addresses.map((addr, i) => {
              const done = dmxFlags[i];
              return (
                <TouchableOpacity key={i} onPress={() => toggleDmxFixture(i)} style={[styles.dmxGridItem, done && styles.dmxGridItemIdeal]}>
                  <Text style={styles.dmxGridLbl}>{done ? "✓ " : ""}{t.fixtureLabel.replace("{n}", i + 1)}</Text>
                  <Text style={[styles.dmxGridVal, done && { color: C.green }]}>{String(addr).padStart(3, "0")}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {dmxResult.overLimit && (
            <InfoBox title={"⚠️ " + t.caution} amber>
              {t.dmxWarning.replace("{end}", dmxResult.lastEnd)}
            </InfoBox>
          )}
          <ActionRow onReset={resetDmx} t={t} shareText={'AmpOhm — ' + t.dmxTitle + '\n' + dmxResult.addresses.map((a, i) => t.fixtureLabel.replace('{n}', i + 1) + ': ' + String(a).padStart(3, '0')).join('\n')} />
          <AdBannerLarge />
        </View>
      )}
      <AdBanner />
    </ScrollView>
    );
  };

  // ---- Screen: SPEAKER CABLE LOSS CALCULATOR ----
  const resetCable = () => setCableResult(null);
  const calcCable = () => {
    const power = Number(cablePower) || 0;
    const length = Number(cableLength) || 0;
    setCableResult(calcCableResult(power, cableImpedance, length));
  };

  const renderCable = () => (
    <ScrollView contentContainerStyle={styles.screenPad}>
      <Header title={t.cableTitle} sub={t.cableSub} onBack={() => goHome(resetCable)} />
      <LangToggle lang={lang} setLang={setLang} />

      {!cableResult ? (
        <View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step1Cable}</Text>
            <View style={styles.rmsWrap}>
              <TextInput
                style={styles.rmsInput}
                keyboardType="numeric"
                value={cablePower}
                onChangeText={setCablePower}
              />
              <Text style={styles.rmsUnit}>{t.watt}</Text>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step2Cable}</Text>
            <ImpedanceChips value={cableImpedance} onChange={setCableImpedance} />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t.step3Cable}</Text>
            <View style={styles.rmsWrap}>
              <TextInput
                style={styles.rmsInput}
                keyboardType="numeric"
                value={cableLength}
                onChangeText={setCableLength}
              />
              <Text style={styles.rmsUnit}>{t.metersUnit}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.calcBtn} onPress={calcCable}>
            <Text style={styles.calcBtnText}>{t.calculate}</Text>
          </TouchableOpacity>
          <InfoBox>{t.cableNote}</InfoBox>
        </View>
      ) : (
        <View>
          <Text style={styles.resultTitleLeft}>{t.cableResultTitle}</Text>
          <Text style={{ color: C.muted, fontSize: 12, marginTop: -6, marginBottom: 12 }}>
            {t.cableCurrentText.replace("{i}", cableResult.current)}
          </Text>
          {cableResult.results.map((r) => {
            const tag =
              r.size === cableResult.recommended.size ? " ✅" :
              r.size === cableResult.best.size ? " ⭐" : "";
            return (
              <View key={r.size} style={styles.ampRow}>
                <Text style={styles.ampRowLbl}>{r.size} mm²{tag}</Text>
                <Text style={styles.ampRowVal}>{r.emoji} {t[r.statusKey]} ({r.dB.toFixed(2)} dB)</Text>
              </View>
            );
          })}
          <View style={[styles.ampRow, styles.ampRowIdeal]}>
            <Text style={styles.ampRowLbl}>{t.recommendedCableLabel}</Text>
            <Text style={[styles.ampRowVal, { color: C.green }]}>{cableResult.recommended.size} mm²</Text>
          </View>
          <View style={styles.ampRow}>
            <Text style={styles.ampRowLbl}>{t.bestCableLabel}</Text>
            <Text style={styles.ampRowVal}>{cableResult.best.size} mm²</Text>
          </View>
          <InfoBox>{t.cableDisclaimer}</InfoBox>
          <ActionRow onReset={resetCable} t={t} shareText={'AmpOhm — ' + t.cableTitle + '\n' + t.recommendedCableLabel + ': ' + cableResult.recommended.size + ' mm²\n' + t.bestCableLabel + ': ' + cableResult.best.size + ' mm²'} />
          <AdBannerLarge />
        </View>
      )}
      <AdBanner />
    </ScrollView>
  );

  // ---- Screen: INFO ----
  const renderInfo = () => (
    <ScrollView contentContainerStyle={styles.screenPad}>
      <Text style={styles.infoTitle}>{t.infoTitle}</Text>
      {t.infoItems.map((item, idx) => (
        <TouchableOpacity
          key={item.t}
          style={styles.infoListItem}
          onPress={() => {
            setInfoDetailIndex(idx);
            setScreen("info-detail");
          }}
        >
          <View style={styles.infoListLeft}>
            <View style={styles.infoDot}>
              <Text style={{ color: C.amber }}>ℹ</Text>
            </View>
            <View>
              <Text style={styles.infoListT}>{item.t}</Text>
              <Text style={styles.infoListS}>{item.s}</Text>
            </View>
          </View>
          <Text style={{ color: C.muted }}>‹</Text>
        </TouchableOpacity>
      ))}
      <AdBanner />
      <BottomNav screen={screen} setScreen={setScreen} t={t} />
    </ScrollView>
  );

  // ---- Screen: INFO DETAIL ----
  const renderInfoDetail = () => {
    const item = t.infoItems[infoDetailIndex];
    return (
      <ScrollView contentContainerStyle={styles.screenPad}>
        <Header title={item.t} sub="" onBack={() => setScreen("info")} />
        <View style={styles.infoDetailBox}>
          <Text style={styles.infoDetailText}>{item.body}</Text>
          {item.contact && (
            <View style={{ marginTop: 12 }}>
              <Text
                style={styles.contactLink}
                onPress={() => Linking.openURL(`mailto:${item.contact.email}`)}
              >
                📧 {item.contact.email}
              </Text>
              <Text
                style={styles.contactLink}
                onPress={() => Linking.openURL(`https://instagram.com/${item.contact.instagram}`)}
              >
                📸 @{item.contact.instagram}
              </Text>
              <Text
                style={styles.contactLink}
                onPress={() => Linking.openURL(`https://youtube.com/@${item.contact.youtube}`)}
              >
                ▶️ {item.contact.youtube}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  // =====================================================================
  // FUTURE INTEGRATIONS — see app.js (web build) for the matching
  // placeholders (Auth, addFavorite, logRecentCalculation,
  // checkForAppUpdate). Kept as comments here so both builds stay in
  // sync when those features are actually implemented.
  // =====================================================================

  let content;
  if (screen === "home") content = renderHome();
  else if (screen === "ohm") content = renderOhm();
  else if (screen === "amp") content = renderAmp();
  else if (screen === "top") content = renderTop();
  else if (screen === "dmx") content = renderDmx();
  else if (screen === "cable") content = renderCable();
  else if (screen === "info") content = renderInfo();
  else if (screen === "info-detail") content = renderInfoDetail();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      {content}
    </SafeAreaView>
  );
}

// =====================================================================
// STYLES
// =====================================================================
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  screenPad: { padding: 20, paddingBottom: 40 },

  topLangPill: {
    alignSelf: "flex-end",
    flexDirection: "row",
    backgroundColor: "rgba(30,41,59,0.8)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
  },
  topLangPillText: { color: "#e2e8f0", fontSize: 12 },

  brand: { alignItems: "center", marginVertical: 20 },
  brandText: { fontSize: 28, fontWeight: "800", color: C.text },
  tagline: { color: C.muted, fontSize: 13, marginTop: 4 },

  cardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(15,23,42,0.7)",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: C.amber,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  iconCircleText: { color: C.card, fontWeight: "900", fontSize: 18 },
  cardTitle: { color: C.text, fontWeight: "700", fontSize: 15 },
  cardSub: { color: C.muted, fontSize: 12 },

  soonBox: {
    borderWidth: 1,
    borderColor: "#334155",
    borderStyle: "dashed",
    borderRadius: 18,
    padding: 16,
    alignItems: "center",
  },
  soonLabel: { color: C.muted, fontSize: 12, marginBottom: 8 },
  soonItem: { color: "#64748b", fontSize: 12, marginVertical: 2 },

  adWrap: { alignItems: "center", marginTop: 16, minHeight: 50 },
  adWrapLarge: { alignItems: "center", marginTop: 16, minHeight: 100 },

  bottomNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 12,
    marginTop: 16,
  },
  navItem: { alignItems: "center" },
  navItemText: { color: "#64748b", fontSize: 11 },

  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(30,41,59,0.8)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "700" },
  headerSub: { color: C.muted, fontSize: 12 },

  langWrap: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: "rgba(30,41,59,0.8)",
    borderRadius: 999,
    padding: 4,
    marginBottom: 20,
  },
  langBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  langBtnActive: { backgroundColor: C.amber },
  langBtnText: { color: "#cbd5e1", fontSize: 12, fontWeight: "600" },
  langBtnTextActive: { color: C.card },

  field: { marginBottom: 20 },
  fieldLabel: { color: "#e2e8f0", fontSize: 14, fontWeight: "600", marginBottom: 8 },
  fieldHint: { color: C.muted, fontSize: 11, marginTop: 8, lineHeight: 16 },

  stepper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    overflow: "hidden",
  },
  stepperBtn: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(30,41,59,0.6)",
  },
  stepperBtnText: { color: C.text, fontSize: 18 },
  stepperVal: { flex: 1, textAlign: "center", color: C.text, fontWeight: "700", fontSize: 18 },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: C.card,
  },
  chipActive: { borderColor: C.amber, backgroundColor: "rgba(251,191,36,0.08)" },
  chipText: { color: "#cbd5e1", fontWeight: "600" },
  chipTextActive: { color: C.amber },

  connGrid: { flexDirection: "row", gap: 12 },
  connBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
    gap: 8,
  },
  connBtnActive: { borderColor: C.amber, backgroundColor: "rgba(251,191,36,0.06)" },
  connGlyph: { fontSize: 20, color: "#cbd5e1" },
  connText: { color: "#cbd5e1", fontWeight: "600", fontSize: 13 },
  connTextActive: { color: C.amber },

  rmsWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    overflow: "hidden",
  },
  rmsInput: { flex: 1, color: C.text, fontWeight: "700", fontSize: 16, paddingHorizontal: 16, paddingVertical: 14 },
  rmsUnit: { color: C.muted, fontSize: 13, paddingHorizontal: 16, borderLeftWidth: 1, borderLeftColor: C.border, paddingVertical: 14 },

  calcBtn: { backgroundColor: C.amber, borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  calcBtnText: { color: C.card, fontWeight: "800", fontSize: 15 },

  resultTitle: { textAlign: "center", color: "#cbd5e1", fontWeight: "700", fontSize: 14, marginBottom: 12 },
  resultTitleLeft: { color: "#cbd5e1", fontWeight: "700", fontSize: 14, marginBottom: 10, marginTop: 4 },

  resultBox: {
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.3)",
    backgroundColor: "rgba(52,211,153,0.05)",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
    marginBottom: 16,
  },
  resultLbl: { color: C.muted, fontSize: 12, marginBottom: 4 },
  resultBig: { fontSize: 46, fontWeight: "900", color: C.green, marginVertical: 8 },

  statusPill: { borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
  statusPillText: { fontSize: 12, fontWeight: "600" },

  infoBox: {
    backgroundColor: "rgba(15,23,42,0.6)",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  infoBoxAmber: { backgroundColor: "rgba(251,191,36,0.05)", borderColor: "rgba(251,191,36,0.2)" },
  infoBoxTitle: { fontSize: 12, fontWeight: "700", marginBottom: 4, color: "#e2e8f0" },
  infoBoxText: { fontSize: 12, color: "#cbd5e1", lineHeight: 18 },

  actionRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  actionBtn: { flex: 1, borderWidth: 1, borderColor: "#334155", borderRadius: 14, paddingVertical: 11, alignItems: "center" },
  actionBtnText: { color: "#e2e8f0", fontSize: 13, fontWeight: "600" },

  ampRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: "rgba(15,23,42,0.6)",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  ampRowIdeal: { borderColor: "rgba(52,211,153,0.3)", backgroundColor: "rgba(52,211,153,0.05)" },
  ampRowLbl: { color: "#cbd5e1", fontSize: 13 },
  ampRowVal: { color: C.text, fontSize: 16, fontWeight: "800" },

  // DMX fixture list — 2-column grid so long fixture counts don't
  // force a very long single scroll. Separate from ampRow (used by
  // other calculators' results) so nothing else is affected.
  dmxGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  dmxGridItem: {
    width: "48%",
    backgroundColor: "rgba(15,23,42,0.6)",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    padding: 9,
    marginBottom: 8,
  },
  dmxGridItemIdeal: { borderColor: "rgba(52,211,153,0.3)", backgroundColor: "rgba(52,211,153,0.05)" },
  dmxGridLbl: { fontSize: 11, color: "#94a3b8" },
  dmxGridVal: { fontSize: 15, fontWeight: "800", color: C.text, marginTop: 2 },

  infoTitle: { color: C.text, fontSize: 20, fontWeight: "700", marginBottom: 16 },
  infoListItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(15,23,42,0.7)",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  infoListLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  infoDot: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(30,41,59,0.8)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  infoListT: { color: C.text, fontSize: 13, fontWeight: "600" },
  infoListS: { color: C.muted, fontSize: 11 },

  infoDetailBox: { backgroundColor: "rgba(15,23,42,0.5)", borderRadius: 14, padding: 14 },
  infoDetailText: { color: "#e2e8f0", fontSize: 13, lineHeight: 22 },
  contactLink: { color: C.amber, fontSize: 13, lineHeight: 24 },
});
