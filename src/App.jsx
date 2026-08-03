import React, { useState, useEffect, useRef } from 'react';
import {
  Building2, Search, Plus, X, Save, Phone, Mail, MapPin, User, Edit3, Trash2,
  ChevronLeft, Loader2, Clock, AlertCircle, LogOut, Video, FileText, Circle, Download, Home,
} from 'lucide-react';
import {
  collection, collectionGroup, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy, where, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { onAuthStateChanged, signInWithPopup, getRedirectResult, signOut } from 'firebase/auth';
import { auth, googleProvider, db, ALLOWED_EMAIL_DOMAIN } from './firebase';

const REGIONS = ['서울특별시','부산광역시','대구광역시','인천광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전남광주통합특별시','경상북도','경상남도','제주특별자치도'];

const TERM_OPTIONS = ['초선', '재선', '3선', '4선', '5선 이상'];

const CONTRACT_CATEGORIES = ['관광', '고향사랑기부제', '지역화폐', '기타'];

// 트랙별로 진행 단계와 담당자 필드 접두어, 색상을 함께 정의한다.
const TRACKS = [
  {
    key: 'councilStage', contactPrefix: 'council',
    label: '지속가능관광지방정부협의회', short: '협의회',
    stages: [
      { value: '미제안', color: '#ADB2B9' },
      { value: '제안 완료', color: '#8A8F98' },
      { value: '논의·검토 중', color: '#B8862E' },
      { value: '가입 완료', color: '#3F7A57' },
      { value: '불발', color: '#A6453A' },
    ],
  },
  {
    key: 'wegiveStage', contactPrefix: 'wegive',
    label: '위기브(고향사랑기부제)', short: '위기브',
    stages: [
      { value: '미제안', color: '#ADB2B9' },
      { value: '제안 완료', color: '#8A8F98' },
      { value: '논의·검토 중', color: '#B8862E' },
      { value: '입점 완료', color: '#3F7A57' },
      { value: '불발', color: '#A6453A' },
    ],
  },
  {
    key: 'wegivepayStage', contactPrefix: 'wegivepay',
    label: '위기브페이(지역화폐)', short: '위기브페이',
    stages: [
      { value: '미제안', color: '#ADB2B9' },
      { value: '제안 완료', color: '#8A8F98' },
      { value: '논의·검토 중', color: '#B8862E' },
      { value: '입점 완료', color: '#3F7A57' },
      { value: '불발', color: '#A6453A' },
    ],
  },
];

const HISTORY_TYPES = ['방문', '전화', '이메일', '화상미팅', '내부검토', '기타'];
const HISTORY_TYPE_ICON = { 방문: MapPin, 전화: Phone, 이메일: Mail, 화상미팅: Video, 내부검토: FileText, 기타: Circle };

const HISTORY_CATEGORIES = [
  { label: '협의회', color: '#2C6E5E' },
  { label: '고향사랑기부제', color: '#B8862E' },
  { label: '지역화폐', color: '#6B4FA0' },
];

function categoryColorFor(label) {
  const found = HISTORY_CATEGORIES.find(c => c.label === label);
  return found ? found.color : '#8A8F98';
}

// 히스토리 내용에서 **굵게** 표시를 굵은 글씨로 렌더링한다.
function renderHistoryContent(text) {
  const parts = (text || '').split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function stageColorFor(track, stage) {
  const found = track.stages.find(s => s.value === stage);
  return found ? found.color : '#8A8F98';
}

function emptyMuni() {
  return {
    name: '', region: REGIONS[0],
    headName: '', party: '', termCount: TERM_OPTIONS[0],
    councilDept: '', councilContactName: '', councilContactPosition: '', councilContactPhone: '', councilContactEmail: '',
    wegiveDept: '', wegiveContactName: '', wegiveContactPosition: '', wegiveContactPhone: '', wegiveContactEmail: '',
    wegivepayDept: '', wegivepayContactName: '', wegivepayContactPosition: '', wegivepayContactPhone: '', wegivepayContactEmail: '',
    councilStage: '미제안', wegiveStage: '미제안', wegivepayStage: '미제안',
    fundingLastYearTotal: '', fundingLastYearWegive: '', fundingThisYearTarget: '',
    currencyLastYearTotal: '', currencyThisYearPlanned: '', currencyWegivepayAmount: '',
    memo: '',
  };
}

function emptyHistoryDraft(defaultAuthor) {
  return { category: HISTORY_CATEGORIES[0].label, date: new Date().toISOString().slice(0, 10), type: '방문', author: defaultAuthor || '', content: '' };
}

function pad2(n) { return String(n).padStart(2, '0'); }
function emptyContractDraft() {
  const now = new Date();
  return { category: CONTRACT_CATEGORIES[0], name: '', period: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`, amount: '', memo: '' };
}

// 연간/월간 목표 문서 키
function currentYear() { return new Date().getFullYear(); }
function currentMonth() { return new Date().getMonth() + 1; }
function monthlyGoalId(year, month) { return `${year}-${month}`; }
function emptyPeriodGoalDraft() {
  return {
    fundingTarget: '', fundingActual: '',
    councilTarget: '', wegiveTarget: '', wegivepayTarget: '',
    currencyTarget: '', currencyActual: '',
    revenueTarget: '',
  };
}

// ---------- 인증 ----------

function useAuthUser() {
  const [user, setUser] = useState(undefined); // undefined = 확인 중, null = 로그아웃 상태
  const [redirectError, setRedirectError] = useState('');
  useEffect(() => {
    getRedirectResult(auth).catch(e => setRedirectError(`${e.code || ''} ${e.message}`));
  }, []);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return { user, redirectError };
}

function SignInScreen({ externalError }) {
  const [signingIn, setSigningIn] = useState(false);
  const [err, setErr] = useState('');
  async function handleSignIn() {
    setSigningIn(true);
    setErr('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setErr(`${e.code || ''} ${e.message}`);
    }
    setSigningIn(false);
  }
  const shownError = err || externalError;
  return (
    <div className="gate-screen">
      <Building2 size={40} strokeWidth={1.2} />
      <h2 className="brand-heading">지자체 영업/대관 관리</h2>
      <p>회사 구글 계정으로 로그인하면 이용할 수 있어요.</p>
      {shownError && <div className="error-banner"><AlertCircle size={14}/> {shownError}</div>}
      <button className="btn-primary" onClick={handleSignIn} disabled={signingIn}>{signingIn ? '로그인 중…' : '구글 계정으로 로그인'}</button>
    </div>
  );
}

function AccessDenied({ user }) {
  return (
    <div className="gate-screen">
      <AlertCircle size={40} strokeWidth={1.2} color="#A6453A" />
      <h2 className="brand-heading">접근 권한이 없어요</h2>
      <p>{user.email} 계정은 이 도구에 접근할 수 없어요.<br/>회사 이메일 계정으로 다시 로그인해주세요.</p>
      <button className="btn-secondary" onClick={() => signOut(auth)}><LogOut size={14}/> 다른 계정으로 로그인</button>
    </div>
  );
}

export default function Root() {
  const { user, redirectError } = useAuthUser();
  if (user === undefined) {
    return <div className="gate-screen"><Loader2 size={28} className="spin" /></div>;
  }
  if (!user) return <SignInScreen externalError={redirectError} />;
  if (ALLOWED_EMAIL_DOMAIN && !(user.email || '').toLowerCase().endsWith('@' + ALLOWED_EMAIL_DOMAIN.toLowerCase())) {
    return <AccessDenied user={user} />;
  }
  return <MainApp user={user} />;
}

// ---------- 메인 앱 ----------

function MainApp({ user }) {
  const [munis, setMunis] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [history, setHistory] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loadingSub, setLoadingSub] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(emptyMuni());
  const [isEditing, setIsEditing] = useState(false);
  const [tab, setTab] = useState('info');
  const [historyDraft, setHistoryDraft] = useState(emptyHistoryDraft(user.displayName));
  const [editingHistoryId, setEditingHistoryId] = useState(null);
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState(null);
  const [historyMonthFilter, setHistoryMonthFilter] = useState(null);
  const [contractDraft, setContractDraft] = useState(emptyContractDraft());
  const [editingContractId, setEditingContractId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);
  const [activityRaw, setActivityRaw] = useState([]);
  const [yearHistoryDocs, setYearHistoryDocs] = useState([]);
  const [yearContracts, setYearContracts] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [annualGoal, setAnnualGoal] = useState(null);
  const [monthlyGoal, setMonthlyGoal] = useState(null);
  const [editingAnnual, setEditingAnnual] = useState(false);
  const [annualDraft, setAnnualDraft] = useState(emptyPeriodGoalDraft());
  const [editingMonthly, setEditingMonthly] = useState(false);
  const [monthlyDraft, setMonthlyDraft] = useState(emptyPeriodGoalDraft());
  const [savingGoal, setSavingGoal] = useState(false);

  const detail = munis.find(m => m.id === selectedId) || null;

  useEffect(() => {
    const q = query(collection(db, 'municipalities'), orderBy('name'));
    const unsub = onSnapshot(q, snap => {
      setMunis(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingList(false);
    }, err => {
      setError(`목록을 불러오지 못했어요 (${err.message}).`);
      setLoadingList(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    setHistoryCategoryFilter(null);
    setHistoryMonthFilter(null);
    if (!selectedId) { setHistory([]); setContracts([]); return; }
    setLoadingSub(true);
    const hq = query(collection(db, 'municipalities', selectedId, 'history'), orderBy('date', 'desc'));
    const unsubH = onSnapshot(hq, snap => {
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingSub(false);
    }, err => setError(`히스토리를 불러오지 못했어요 (${err.message}).`));
    const cq = query(collection(db, 'municipalities', selectedId, 'contracts'), orderBy('year', 'desc'));
    const unsubC = onSnapshot(cq, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.year - a.year) || ((b.month || 0) - (a.month || 0)));
      setContracts(list);
    }, err => setError(`용역 현황을 불러오지 못했어요 (${err.message}).`));
    return () => { unsubH(); unsubC(); };
  }, [selectedId]);

  async function handleExportAll() {
    setExporting(true);
    setError('');
    try {
      const bundle = { exportedAt: new Date().toISOString(), municipalities: [] };
      for (const m of munis) {
        let hist = [], contr = [];
        try {
          const hs = await getDocs(collection(db, 'municipalities', m.id, 'history'));
          hist = hs.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {}
        try {
          const cs = await getDocs(collection(db, 'municipalities', m.id, 'contracts'));
          contr = cs.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {}
        bundle.municipalities.push({ ...m, history: hist, contracts: contr });
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `지자체_영업대관관리_백업_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`백업 다운로드에 실패했어요 (${e.message}).`);
    }
    setExporting(false);
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const text = await file.text();
      const items = JSON.parse(text);
      if (!Array.isArray(items)) throw new Error('JSON 파일이 지자체 배열 형식이 아니에요.');

      const existingNames = new Set(munis.map(m => m.name));
      let addedMuni = 0, skippedMuni = 0, addedHistory = 0;

      for (const item of items) {
        if (!item.name || !item.name.trim()) continue;
        if (existingNames.has(item.name.trim())) { skippedMuni++; continue; }

        const record = {
          ...emptyMuni(),
          name: item.name.trim(),
          region: item.region || REGIONS[0],
          wegiveDept: item.wegiveDept || '',
          wegiveContactName: item.wegiveContactName || '',
          wegiveContactPosition: item.wegiveContactPosition || '',
          wegiveContactPhone: item.wegiveContactPhone || '',
          wegiveContactEmail: item.wegiveContactEmail || '',
          memo: item.memo || '',
          updatedAt: serverTimestamp(),
          updatedBy: user.displayName || user.email,
        };
        const ref = await addDoc(collection(db, 'municipalities'), record);
        addedMuni++;
        existingNames.add(item.name.trim());

        for (const h of (item.history || [])) {
          if (!h.content) continue;
          await addDoc(collection(db, 'municipalities', ref.id, 'history'), {
            category: h.category || HISTORY_CATEGORIES[0].label,
            date: h.date || new Date().toISOString().slice(0, 10),
            type: h.type || '기타',
            author: h.author || '',
            content: h.content,
            createdAt: serverTimestamp(),
          });
          addedHistory++;
        }
      }
      setError(`가져오기 완료 — 지자체 ${addedMuni}개 추가, ${skippedMuni}개는 이미 있어서 건너뜀, 히스토리 ${addedHistory}건 추가.`);
    } catch (e) {
      setError(`가져오기에 실패했어요 (${e.message}).`);
    }
    setImporting(false);
    e.target.value = '';
  }

  useEffect(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const q = query(collection(db, 'activity'), where('at', '>=', sevenDaysAgo));
    const unsub = onSnapshot(q, snap => {
      setActivityRaw(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => setError(`활동 내역을 불러오지 못했어요 (${err.message}).`));
    return unsub;
  }, []);

  useEffect(() => {
    const y = currentYear();
    const q = query(collectionGroup(db, 'history'), where('date', '>=', `${y}-01-01`), where('date', '<=', `${y}-12-31`));
    const unsub = onSnapshot(q, snap => {
      setYearHistoryDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => setError(`히스토리 요약 데이터를 불러오지 못했어요 (${err.message}). Firestore 콘솔에 색인 생성 링크가 떴다면 그걸 클릭해 색인을 만들어주세요.`));
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collectionGroup(db, 'contracts'), where('year', '==', currentYear()));
    const unsub = onSnapshot(q, snap => {
      setYearContracts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => setError(`매출 데이터를 불러오지 못했어요 (${err.message}). Firestore 콘솔에 색인 생성 링크가 떴다면 그걸 클릭해 색인을 만들어주세요.`));
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'annualGoals', String(currentYear())), snap => {
      setAnnualGoal(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, err => setError(`연간 목표를 불러오지 못했어요 (${err.message}).`));
    return unsub;
  }, []);

  useEffect(() => {
    const id = monthlyGoalId(currentYear(), selectedMonth);
    const unsub = onSnapshot(doc(db, 'monthlyGoals', id), snap => {
      setMonthlyGoal(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setEditingMonthly(false);
    }, err => setError(`월간 목표를 불러오지 못했어요 (${err.message}).`));
    return unsub;
  }, [selectedMonth]);

  async function logActivity(entry) {
    try {
      await addDoc(collection(db, 'activity'), { ...entry, at: serverTimestamp() });
    } catch (e) { /* 활동 로그 실패는 조용히 무시 - 본 데이터 저장에는 영향 없음 */ }
  }

  async function handleSaveAnnualGoal(e) {
    if (e && e.preventDefault) e.preventDefault();
    setSavingGoal(true);
    setError('');
    try {
      await setDoc(doc(db, 'annualGoals', String(currentYear())), {
        year: currentYear(),
        fundingTarget: Number(annualDraft.fundingTarget) || 0,
        fundingActual: Number(annualDraft.fundingActual) || 0,
        councilTarget: Number(annualDraft.councilTarget) || 0,
        wegiveTarget: Number(annualDraft.wegiveTarget) || 0,
        wegivepayTarget: Number(annualDraft.wegivepayTarget) || 0,
        currencyTarget: Number(annualDraft.currencyTarget) || 0,
        currencyActual: Number(annualDraft.currencyActual) || 0,
        revenueTarget: Number(annualDraft.revenueTarget) || 0,
        updatedBy: user.displayName || user.email, updatedAt: serverTimestamp(),
      }, { merge: true });
      setEditingAnnual(false);
    } catch (e) {
      setError(`연간 목표 저장에 실패했어요 (${e.message}).`);
    }
    setSavingGoal(false);
  }

  async function handleSaveMonthlyGoal(e) {
    if (e && e.preventDefault) e.preventDefault();
    setSavingGoal(true);
    setError('');
    const id = monthlyGoalId(currentYear(), selectedMonth);
    try {
      await setDoc(doc(db, 'monthlyGoals', id), {
        year: currentYear(), month: selectedMonth,
        fundingTarget: Number(monthlyDraft.fundingTarget) || 0,
        fundingActual: Number(monthlyDraft.fundingActual) || 0,
        councilTarget: Number(monthlyDraft.councilTarget) || 0,
        wegiveTarget: Number(monthlyDraft.wegiveTarget) || 0,
        wegivepayTarget: Number(monthlyDraft.wegivepayTarget) || 0,
        currencyTarget: Number(monthlyDraft.currencyTarget) || 0,
        currencyActual: Number(monthlyDraft.currencyActual) || 0,
        revenueTarget: Number(monthlyDraft.revenueTarget) || 0,
        updatedBy: user.displayName || user.email, updatedAt: serverTimestamp(),
      }, { merge: true });
      setEditingMonthly(false);
    } catch (e) {
      setError(`월간 목표 저장에 실패했어요 (${e.message}).`);
    }
    setSavingGoal(false);
  }

  function openAddForm() {
    setFormData(emptyMuni());
    setIsEditing(false);
    setShowForm(true);
    setSelectedId(null);
  }

  function openEditForm() {
    if (!detail) return;
    setFormData({ ...emptyMuni(), ...detail });
    setIsEditing(true);
    setShowForm(true);
  }

  async function handleSaveForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.name.trim()) { setError('지자체명을 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    const record = { ...formData, name: formData.name.trim(), updatedAt: serverTimestamp(), updatedBy: user.displayName || user.email };
    try {
      if (isEditing) {
        await updateDoc(doc(db, 'municipalities', selectedId), record);
      } else {
        const ref = await addDoc(collection(db, 'municipalities'), record);
        setSelectedId(ref.id);
      }
      setShowForm(false);
    } catch (e) {
      setError(`저장에 실패했어요 (${e.message}). 입력하신 내용은 남아있으니 다시 시도해보세요.`);
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!selectedId || !detail) return;
    if (!window.confirm(`'${detail.name}' 항목을 삭제할까요? 영업 히스토리·용역 현황도 함께 삭제됩니다.`)) return;
    setError('');
    try {
      await deleteDoc(doc(db, 'municipalities', selectedId));
      const logs = await getDocs(query(collection(db, 'activity'), where('muniId', '==', selectedId)));
      await Promise.all(logs.docs.map(d => deleteDoc(d.ref)));
      setSelectedId(null);
    } catch (e) {
      setError(`삭제에 실패했어요 (${e.message}).`);
    }
  }

  // ---- 히스토리 ----
  function startEditHistory(h) {
    setEditingHistoryId(h.id);
    setHistoryDraft({ category: h.category || HISTORY_CATEGORIES[0].label, date: h.date, type: h.type, author: h.author || '', content: h.content });
  }
  function cancelEditHistory() {
    setEditingHistoryId(null);
    setHistoryDraft(emptyHistoryDraft(user.displayName));
  }
  async function handleSaveHistory(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!historyDraft.content.trim()) { setError('내용을 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    const payload = { ...historyDraft, content: historyDraft.content.trim() };
    let recoveredAsNew = false;
    let historyId = editingHistoryId;
    try {
      if (editingHistoryId) {
        try {
          await updateDoc(doc(db, 'municipalities', selectedId, 'history', editingHistoryId), payload);
        } catch (inner) {
          if (inner.code === 'not-found') {
            // 수정하려던 항목이 그 사이 삭제됨 - 새 항목으로 저장해서 입력한 내용을 잃지 않게 함
            const ref = await addDoc(collection(db, 'municipalities', selectedId, 'history'), { ...payload, createdAt: serverTimestamp() });
            historyId = ref.id;
            recoveredAsNew = true;
          } else {
            throw inner;
          }
        }
      } else {
        const ref = await addDoc(collection(db, 'municipalities', selectedId, 'history'), { ...payload, createdAt: serverTimestamp() });
        historyId = ref.id;
      }
      logActivity({
        muniId: selectedId, muniName: detail?.name || '', kind: 'history', historyId, category: payload.category, type: payload.type,
        date: payload.date, action: (editingHistoryId && !recoveredAsNew) ? 'updated' : 'created', summary: payload.content.slice(0, 60),
        author: payload.author || user.displayName || user.email,
      });
      if (recoveredAsNew) {
        setError('수정하려던 항목이 이미 삭제되어 있어서, 입력하신 내용은 새 히스토리로 저장했어요.');
      }
      setEditingHistoryId(null);
      setHistoryDraft(emptyHistoryDraft(user.displayName));
    } catch (e) {
      setError(`히스토리 저장에 실패했어요 (${e.message}). 입력한 내용은 남아있으니 다시 시도해보세요.`);
    }
    setSaving(false);
  }
  async function handleDeleteHistory(id) {
    if (!window.confirm('이 히스토리를 삭제할까요?')) return;
    try {
      await deleteDoc(doc(db, 'municipalities', selectedId, 'history', id));
      // 이 항목을 가리키던 "최근 활동" 로그도 함께 정리해서 대시보드에 유령 항목이 안 남게 한다.
      const logs = await getDocs(query(collection(db, 'activity'), where('historyId', '==', id)));
      await Promise.all(logs.docs.map(d => deleteDoc(d.ref)));
    } catch (e) {
      setError(`히스토리 삭제에 실패했어요 (${e.message}).`);
    }
  }

  // ---- 용역 ----
  function startEditContract(c) {
    setEditingContractId(c.id);
    setContractDraft({ category: c.category, name: c.name, period: `${c.year}-${pad2(c.month || 1)}`, amount: c.amount, memo: c.memo || '' });
  }
  function cancelEditContract() {
    setEditingContractId(null);
    setContractDraft(emptyContractDraft());
  }
  async function handleSaveContract(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!contractDraft.name.trim()) { setError('용역명을 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    const [pYear, pMonth] = contractDraft.period.split('-').map(Number);
    const payload = {
      category: contractDraft.category, name: contractDraft.name.trim(), memo: contractDraft.memo,
      year: pYear, month: pMonth, amount: Number(contractDraft.amount) || 0,
    };
    let contractId = editingContractId;
    try {
      let recoveredAsNew = false;
      if (editingContractId) {
        try {
          await updateDoc(doc(db, 'municipalities', selectedId, 'contracts', editingContractId), payload);
        } catch (inner) {
          if (inner.code === 'not-found') {
            const ref = await addDoc(collection(db, 'municipalities', selectedId, 'contracts'), { ...payload, createdAt: serverTimestamp() });
            contractId = ref.id;
            recoveredAsNew = true;
          } else {
            throw inner;
          }
        }
      } else {
        const ref = await addDoc(collection(db, 'municipalities', selectedId, 'contracts'), { ...payload, createdAt: serverTimestamp() });
        contractId = ref.id;
      }
      logActivity({
        muniId: selectedId, muniName: detail?.name || '', kind: 'contract', contractId, category: payload.category,
        year: payload.year, month: payload.month, amount: payload.amount,
        action: (editingContractId && !recoveredAsNew) ? 'updated' : 'created',
        summary: `${payload.name} (${payload.amount.toLocaleString('ko-KR')}원)`,
        author: user.displayName || user.email,
      });
      if (recoveredAsNew) {
        setError('수정하려던 항목이 이미 삭제되어 있어서, 입력하신 내용은 새 용역 항목으로 저장했어요.');
      }
      setEditingContractId(null);
      setContractDraft(emptyContractDraft());
    } catch (e) {
      setError(`용역 정보 저장에 실패했어요 (${e.message}).`);
    }
    setSaving(false);
  }
  async function handleDeleteContract(id) {
    if (!window.confirm('이 용역 항목을 삭제할까요?')) return;
    try {
      await deleteDoc(doc(db, 'municipalities', selectedId, 'contracts', id));
      const logs = await getDocs(query(collection(db, 'activity'), where('contractId', '==', id)));
      await Promise.all(logs.docs.map(d => deleteDoc(d.ref)));
    } catch (e) {
      setError(`용역 항목 삭제에 실패했어요 (${e.message}).`);
    }
  }

  const totalContractAmount = contracts.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const filtered = munis.filter(m => m.name.includes(search) || (m.region || '').includes(search));

  const historyMonthCounts = {};
  history.forEach(h => { const m = (h.date || '').slice(0, 7); if (m) historyMonthCounts[m] = (historyMonthCounts[m] || 0) + 1; });
  const historyMonths = Object.keys(historyMonthCounts).sort().reverse();
  const filteredHistory = history.filter(h =>
    (!historyCategoryFilter || h.category === historyCategoryFilter) &&
    (!historyMonthFilter || (h.date || '').slice(0, 7) === historyMonthFilter)
  );

  const activityFeed = activityRaw.slice().sort((a, b) => {
    const ta = a.at?.toDate ? a.at.toDate().getTime() : 0;
    const tb = b.at?.toDate ? b.at.toDate().getTime() : 0;
    return tb - ta;
  });
  const monthActivity = yearHistoryDocs.filter(h => {
    if (!h.date) return false;
    const [y, m] = h.date.split('-').map(Number);
    return y === currentYear() && m === selectedMonth;
  });
  const monthByCategory = {};
  const monthByType = {};
  monthActivity.forEach(a => {
    if (a.category) monthByCategory[a.category] = (monthByCategory[a.category] || 0) + 1;
    if (a.type) monthByType[a.type] = (monthByType[a.type] || 0) + 1;
  });
  // 위기브/위기브페이/협의회 지자체 수는 활동 로그가 아니라 지자체 현재 상태에서 직접 집계 - 항상 정확함
  const councilOnboardedCount = munis.filter(m => m.councilStage === '가입 완료').length;
  const wegiveOnboardedCount = munis.filter(m => m.wegiveStage === '입점 완료').length;
  const wegivepayOnboardedCount = munis.filter(m => m.wegivepayStage === '입점 완료').length;
  // 매출액은 실제 용역(계약) 문서에서 직접 합산 - 수정해도 중복 집계되지 않는 정확한 값
  const annualRevenueActual = yearContracts.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const monthlyRevenueActual = yearContracts.filter(c => c.month === selectedMonth).reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

  return (
    <div className={`app-root ${selectedId || showForm ? 'has-selection' : ''}`}>
      <GlobalStyle />
      <div className="app-header">
        <div className="app-title" style={{cursor:'pointer'}} onClick={() => { setSelectedId(null); setShowForm(false); }}>
          <Building2 size={22} color="#FFFFFF" />
          <div>
            <h1 className="brand-heading">지자체 영업/대관 관리</h1>
            <p>공감만세 사업본부 · 전사 공유 · 총 {munis.length}개 지자체 · {user.email}</p>
          </div>
        </div>
        <div className="search-wrap">
          <Search size={15} />
          <input placeholder="지자체명 또는 지역 검색" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-secondary" onClick={() => { setSelectedId(null); setShowForm(false); }}><Home size={14}/> 대시보드</button>
        <button className="btn-secondary" onClick={handleExportAll} disabled={exporting || munis.length===0}><Download size={14}/> {exporting ? '내보내는 중…' : '백업 다운로드'}</button>
        <button className="btn-secondary" onClick={() => importInputRef.current?.click()} disabled={importing}><Download size={14} style={{transform:'rotate(180deg)'}}/> {importing ? '가져오는 중…' : '데이터 가져오기'}</button>
        <input ref={importInputRef} type="file" accept="application/json" style={{display:'none'}} onChange={handleImportFile} />
        <button className="btn-secondary" onClick={() => signOut(auth)}><LogOut size={14}/> 로그아웃</button>
        <button className="btn-primary" onClick={openAddForm}><Plus size={15}/> 신규 지자체</button>
      </div>

      {error && <div className="error-banner"><AlertCircle size={14}/> {error}</div>}

      <div className="app-grid">
        <div className="sidebar">
          {loadingList ? (
            <div style={{padding:20, fontSize:13, color:'#6B7280'}}>불러오는 중…</div>
          ) : filtered.length === 0 ? (
            <div style={{padding:20, fontSize:13, color:'#6B7280'}}>등록된 지자체가 없어요.<br/>'신규 지자체'로 추가해보세요.</div>
          ) : filtered.map(m => (
            <div key={m.id} className={`muni-item ${selectedId===m.id?'active':''}`} onClick={() => { setSelectedId(m.id); setShowForm(false); setTab('info'); }}>
              <span className="name">{m.name}</span>
              <span className="region">{m.region}</span>
              <div className="mini-stamp-row">
                {TRACKS.map(t => (
                  <span key={t.key} className="mini-stamp" style={{background: stageColorFor(t, m[t.key])}} title={`${t.label}: ${m[t.key] || '미제안'}`}>
                    {t.short} {m[t.key] || '미제안'}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="detail">
          {showForm ? (
            <MuniForm data={formData} setData={setFormData} onSubmit={handleSaveForm} onCancel={() => setShowForm(false)} isEditing={isEditing} saving={saving} />
          ) : !selectedId ? (
            <Dashboard
              activityFeed={activityFeed}
              annualGoal={annualGoal} editingAnnual={editingAnnual} setEditingAnnual={setEditingAnnual}
              annualDraft={annualDraft} setAnnualDraft={setAnnualDraft} onSaveAnnualGoal={handleSaveAnnualGoal}
              selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth}
              monthlyGoal={monthlyGoal} editingMonthly={editingMonthly} setEditingMonthly={setEditingMonthly}
              monthlyDraft={monthlyDraft} setMonthlyDraft={setMonthlyDraft} onSaveMonthlyGoal={handleSaveMonthlyGoal}
              wegiveOnboardedCount={wegiveOnboardedCount} wegivepayOnboardedCount={wegivepayOnboardedCount}
              councilOnboardedCount={councilOnboardedCount}
              annualRevenueActual={annualRevenueActual} monthlyRevenueActual={monthlyRevenueActual}
              monthByCategory={monthByCategory} monthByType={monthByType}
              savingGoal={savingGoal}
              onJumpTo={(muniId, kind) => { setSelectedId(muniId); setTab(kind === 'contract' ? 'contracts' : 'history'); }}
            />
          ) : !detail ? (
            <div className="empty-state"><Loader2 size={24} className="spin" /> 불러오는 중…</div>
          ) : (
            <>
              <button className="back-btn btn-secondary" onClick={() => setSelectedId(null)}><ChevronLeft size={15}/> 목록으로</button>
              <div className="detail-header">
                <div className="detail-title">
                  <h2 className="brand-heading">{detail.name}</h2>
                  {detail.updatedBy && (
                    <span style={{fontSize:11, color:'#6B7280'}}>
                      최근 수정 {detail.updatedAt?.toDate ? detail.updatedAt.toDate().toLocaleDateString('ko-KR') : ''} · {detail.updatedBy}
                    </span>
                  )}
                </div>
                <div style={{display:'flex', gap:8}}>
                  <button className="btn-secondary" onClick={openEditForm}><Edit3 size={14}/> 정보 수정</button>
                  <button className="btn-danger" onClick={handleDelete}><Trash2 size={14}/> 삭제</button>
                </div>
              </div>

              <div className="tabs">
                <button className={`tab-btn ${tab==='info'?'active':''}`} onClick={() => setTab('info')}>기본정보 · 현황</button>
                <button className={`tab-btn ${tab==='history'?'active':''}`} onClick={() => setTab('history')}>영업 히스토리 ({history.length})</button>
                <button className={`tab-btn ${tab==='contracts'?'active':''}`} onClick={() => setTab('contracts')}>용역 현황 ({contracts.length})</button>
              </div>

              {tab === 'info' && (
                <>
                  <div className="section-title">기본 정보</div>
                  <div className="info-grid">
                    <Field label="지역" value={detail.region} icon={<MapPin size={13}/>} />
                    <Field label="단체장 이름" value={detail.headName} icon={<User size={13}/>} />
                    <Field label="소속 정당" value={detail.party} />
                    <Field label="선수" value={detail.termCount} />
                  </div>

                  <div className="section-title">업무별 담당자</div>
                  <div className="stage-grid">
                    {TRACKS.map(t => (
                      <div key={t.key} className="stage-card">
                        <div className="stage-card-label">{t.label}</div>
                        <div className="icon-row"><Building2 size={13}/>{detail[`${t.contactPrefix}Dept`] || '미입력'}</div>
                        <div className="icon-row"><User size={13}/>{detail[`${t.contactPrefix}ContactName`] || '미입력'}{detail[`${t.contactPrefix}ContactPosition`] && ` (${detail[`${t.contactPrefix}ContactPosition`]})`}</div>
                        <div className="icon-row"><Phone size={13}/>{detail[`${t.contactPrefix}ContactPhone`] || '미입력'}</div>
                        <div className="icon-row"><Mail size={13}/>{detail[`${t.contactPrefix}ContactEmail`] || '미입력'}</div>
                      </div>
                    ))}
                  </div>

                  <div className="section-title">추진 현황</div>
                  <div className="stage-grid">
                    {TRACKS.map(t => (
                      <div key={t.key} className="stage-card">
                        <div className="stage-card-label">{t.label}</div>
                        <span className="stamp" style={{background: stageColorFor(t, detail[t.key])}}>{detail[t.key] || '미제안'}</span>
                      </div>
                    ))}
                  </div>

                  <div className="section-title">고향사랑기부제 모금 현황</div>
                  <div className="info-grid">
                    <Field label="작년 총 모금액" value={detail.fundingLastYearTotal} />
                    <Field label="작년 위기브 모금액" value={detail.fundingLastYearWegive} />
                    <Field label="올해 목표액" value={detail.fundingThisYearTarget} />
                  </div>

                  <div className="section-title">지역화폐 발행 현황</div>
                  <div className="info-grid">
                    <Field label="작년 총 발행액" value={detail.currencyLastYearTotal} />
                    <Field label="올해 발행 예정액" value={detail.currencyThisYearPlanned} />
                    <Field label="위기브페이 발행액" value={detail.currencyWegivepayAmount} />
                  </div>

                  <div style={{marginTop:14}}><Field label="비고" value={detail.memo} full /></div>
                </>
              )}

              {tab === 'history' && (
                <>
                  <form className="history-form" onSubmit={handleSaveHistory}>
                    {editingHistoryId && <div className="editing-badge">히스토리 수정 중</div>}
                    <div className="form-grid">
                      <div className="form-field">
                        <label>사업</label>
                        <select value={historyDraft.category} onChange={e => setHistoryDraft({...historyDraft, category:e.target.value})}>
                          {HISTORY_CATEGORIES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>날짜</label>
                        <input type="date" value={historyDraft.date} onChange={e => setHistoryDraft({...historyDraft, date:e.target.value})} />
                      </div>
                      <div className="form-field">
                        <label>유형</label>
                        <select value={historyDraft.type} onChange={e => setHistoryDraft({...historyDraft, type:e.target.value})}>
                          {HISTORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>담당자</label>
                        <input value={historyDraft.author} onChange={e => setHistoryDraft({...historyDraft, author:e.target.value})} placeholder="예: 노진호" />
                      </div>
                      <div className="form-field full">
                        <label>내용 (**이렇게 감싸면** 굵게 표시돼요)</label>
                        <textarea value={historyDraft.content} onChange={e => setHistoryDraft({...historyDraft, content:e.target.value})} placeholder="미팅/통화 내용, 논의 사항, 다음 액션 등을 기록하세요. **핵심 내용**은 별표 두 개로 감싸면 굵게 표시돼요." />
                      </div>
                    </div>
                    <div className="form-actions">
                      <button className="btn-primary" type="submit" disabled={saving}><Save size={14}/> {saving ? '저장 중…' : editingHistoryId ? '수정 저장' : '히스토리 추가'}</button>
                      {editingHistoryId && <button type="button" className="btn-secondary" onClick={cancelEditHistory}><X size={14}/> 취소</button>}
                    </div>
                  </form>

                  {history.length > 0 && (
                    <div className="filter-row">
                      <button className={`filter-chip ${!historyCategoryFilter?'active':''}`} onClick={() => setHistoryCategoryFilter(null)}>전체 사업</button>
                      {HISTORY_CATEGORIES.map(c => (
                        <button key={c.label} className="filter-chip" style={historyCategoryFilter===c.label ? {background:c.color, color:'#fff', borderColor:c.color} : {}} onClick={() => setHistoryCategoryFilter(historyCategoryFilter===c.label ? null : c.label)}>{c.label}</button>
                      ))}
                    </div>
                  )}
                  {historyMonths.length > 0 && (
                    <div className="filter-row">
                      <button className={`filter-chip ${!historyMonthFilter?'active':''}`} onClick={() => setHistoryMonthFilter(null)}>전체 기간</button>
                      {historyMonths.map(m => {
                        const [y, mo] = m.split('-');
                        return (
                          <button key={m} className={`filter-chip ${historyMonthFilter===m?'active':''}`} onClick={() => setHistoryMonthFilter(historyMonthFilter===m ? null : m)}>
                            {y}년 {parseInt(mo,10)}월 ({historyMonthCounts[m]})
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {loadingSub ? (
                    <div style={{fontSize:13, color:'#6B7280'}}>불러오는 중…</div>
                  ) : history.length === 0 ? (
                    <div style={{fontSize:13, color:'#6B7280'}}>아직 기록된 영업 히스토리가 없어요.</div>
                  ) : filteredHistory.length === 0 ? (
                    <div style={{fontSize:13, color:'#6B7280'}}>선택한 조건에 맞는 히스토리가 없어요.</div>
                  ) : filteredHistory.map(h => {
                    const Icon = HISTORY_TYPE_ICON[h.type] || Circle;
                    const catColor = categoryColorFor(h.category);
                    return (
                      <div key={h.id} className="history-entry">
                        <div className="history-icon" style={{background: catColor + '22'}}><Icon size={14} color={catColor}/></div>
                        <div className="history-body">
                          <div className="meta-pills">
                            {h.category && <span className="pill" style={{background: catColor, color:'#fff'}}>{h.category}</span>}
                            <span className="pill pill-date"><Clock size={11}/> {h.date}</span>
                            <span className="pill pill-type">{h.type}</span>
                            {h.author && <span className="pill pill-author"><User size={11}/> {h.author}</span>}
                          </div>
                          <div className="content">{renderHistoryContent(h.content)}</div>
                        </div>
                        <div className="history-actions">
                          <button className="icon-btn" onClick={() => startEditHistory(h)} title="수정"><Edit3 size={13}/></button>
                          <button className="icon-btn" onClick={() => handleDeleteHistory(h.id)} title="삭제"><Trash2 size={13}/></button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {tab === 'contracts' && (
                <>
                  <form className="history-form" onSubmit={handleSaveContract}>
                    {editingContractId && <div className="editing-badge">용역 정보 수정 중</div>}
                    <div className="form-grid">
                      <div className="form-field">
                        <label>구분</label>
                        <select value={contractDraft.category} onChange={e => setContractDraft({...contractDraft, category:e.target.value})}>
                          {CONTRACT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>계약 연월</label>
                        <input type="month" value={contractDraft.period} onChange={e => setContractDraft({...contractDraft, period:e.target.value})} />
                      </div>
                      <div className="form-field full">
                        <label>용역명</label>
                        <input value={contractDraft.name} onChange={e => setContractDraft({...contractDraft, name:e.target.value})} placeholder="예: OO 홍보 콘텐츠 제작 용역" />
                      </div>
                      <div className="form-field">
                        <label>계약금액 (원)</label>
                        <input type="number" value={contractDraft.amount} onChange={e => setContractDraft({...contractDraft, amount:e.target.value})} placeholder="숫자만 입력" />
                      </div>
                      <div className="form-field full">
                        <label>비고</label>
                        <input value={contractDraft.memo} onChange={e => setContractDraft({...contractDraft, memo:e.target.value})} />
                      </div>
                    </div>
                    <div className="form-actions">
                      <button className="btn-primary" type="submit" disabled={saving}><Save size={14}/> {saving ? '저장 중…' : editingContractId ? '수정 저장' : '용역 추가'}</button>
                      {editingContractId && <button type="button" className="btn-secondary" onClick={cancelEditContract}><X size={14}/> 취소</button>}
                    </div>
                  </form>

                  {contracts.length > 0 && (
                    <div className="total-line">총 계약금액: {totalContractAmount.toLocaleString('ko-KR')}원 ({contracts.length}건)</div>
                  )}

                  {contracts.length === 0 ? (
                    <div style={{fontSize:13, color:'#6B7280'}}>아직 등록된 용역이 없어요.</div>
                  ) : (
                    <div className="contract-table">
                      <div className="contract-row contract-head">
                        <span>구분</span><span>용역명</span><span>연월</span><span>계약금액</span><span>비고</span><span></span>
                      </div>
                      {contracts.map(c => (
                        <div key={c.id} className="contract-row">
                          <span>{c.category}</span>
                          <span>{c.name}</span>
                          <span>{c.year}-{pad2(c.month || 1)}</span>
                          <span>{Number(c.amount || 0).toLocaleString('ko-KR')}원</span>
                          <span className="muted">{c.memo || '-'}</span>
                          <span className="history-actions">
                            <button className="icon-btn" onClick={() => startEditContract(c)} title="수정"><Edit3 size={13}/></button>
                            <button className="icon-btn" onClick={() => handleDeleteContract(c.id)} title="삭제"><Trash2 size={13}/></button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const MONTH_LABELS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

function GoalBar({ count, target }) {
  if (!target) return null;
  const pct = Math.min(100, Math.round((count / target) * 100));
  const done = count >= target;
  return (
    <div className="goal-bar-track"><div className="goal-bar-fill" style={{ width: `${pct}%`, background: done ? '#3F7A57' : '#B8862E' }} /></div>
  );
}

function StatCard({ label, actual, target, format }) {
  const a = Number(actual) || 0;
  const t = Number(target) || 0;
  const pct = t > 0 ? Math.min(100, Math.round((a / t) * 100)) : null;
  const done = t > 0 && a >= t;
  const fmt = n => format === 'currency' ? `${n.toLocaleString('ko-KR')}원` : `${n.toLocaleString('ko-KR')}개`;
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{t > 0 ? fmt(t) : fmt(a)}</div>
      {t > 0 ? (
        <>
          <div className="stat-target">실적 {fmt(a)}</div>
          <GoalBar count={a} target={t} />
          <div className="stat-status" style={{ color: done ? '#3F7A57' : '#B8862E' }}>
            {done ? `✓ 목표 달성 (${pct}%)` : `${pct}% 달성 · ${fmt(t - a)} 남음`}
          </div>
        </>
      ) : (
        <div className="stat-target">목표를 입력하면 진행률이 표시돼요</div>
      )}
    </div>
  );
}

function PeriodGoalSection({ label, goal, editing, setEditing, draft, setDraft, onSave, councilActual, wegiveActual, wegivepayActual, revenueActual, savingGoal }) {
  function openEdit() {
    setDraft(goal ? {
      fundingTarget: goal.fundingTarget || '', fundingActual: goal.fundingActual || '',
      councilTarget: goal.councilTarget || '', wegiveTarget: goal.wegiveTarget || '', wegivepayTarget: goal.wegivepayTarget || '',
      currencyTarget: goal.currencyTarget || '', currencyActual: goal.currencyActual || '',
      revenueTarget: goal.revenueTarget || '',
    } : emptyPeriodGoalDraft());
    setEditing(true);
  }
  return (
    <>
      <div className="section-title">{label}</div>
      {editing ? (
        <form className="history-form" onSubmit={onSave}>
          <div className="form-grid">
            <div className="form-field"><label>모금액 목표(원)</label><input type="number" value={draft.fundingTarget} onChange={e=>setDraft({...draft, fundingTarget:e.target.value})} placeholder="예: 500000000" /></div>
            <div className="form-field"><label>모금액 실적(원)</label><input type="number" value={draft.fundingActual} onChange={e=>setDraft({...draft, fundingActual:e.target.value})} placeholder="예: 320000000" /></div>
            <div className="form-field"><label>협의회 회원 지자체 목표(개)</label><input type="number" value={draft.councilTarget} onChange={e=>setDraft({...draft, councilTarget:e.target.value})} placeholder="예: 40" /></div>
            <div className="form-field"><label>위기브 입점 목표(개)</label><input type="number" value={draft.wegiveTarget} onChange={e=>setDraft({...draft, wegiveTarget:e.target.value})} placeholder="예: 60" /></div>
            <div className="form-field"><label>위기브페이 입점 목표(개)</label><input type="number" value={draft.wegivepayTarget} onChange={e=>setDraft({...draft, wegivepayTarget:e.target.value})} placeholder="예: 30" /></div>
            <div className="form-field"><label>위기브페이 발행액 목표(원)</label><input type="number" value={draft.currencyTarget} onChange={e=>setDraft({...draft, currencyTarget:e.target.value})} placeholder="예: 200000000" /></div>
            <div className="form-field"><label>위기브페이 발행액 실적(원)</label><input type="number" value={draft.currencyActual} onChange={e=>setDraft({...draft, currencyActual:e.target.value})} placeholder="예: 90000000" /></div>
            <div className="form-field"><label>매출액 목표(원)</label><input type="number" value={draft.revenueTarget} onChange={e=>setDraft({...draft, revenueTarget:e.target.value})} placeholder="예: 80000000" /></div>
          </div>
          <div style={{fontSize:11, color:'#6B7280', margin:'-2px 0 10px'}}>협의회·위기브·위기브페이 입점 지자체 수와 매출액의 "실적"은 자동 집계돼요 (목표만 입력하시면 됩니다).</div>
          <div className="form-actions">
            <button className="btn-primary" type="submit" disabled={savingGoal}><Save size={14}/> {savingGoal ? '저장 중…' : '저장'}</button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}><X size={14}/> 취소</button>
          </div>
        </form>
      ) : (
        <>
          <div style={{display:'flex', justifyContent:'flex-end', marginBottom:10}}>
            <button className="btn-secondary" onClick={openEdit}><Edit3 size={13}/> 목표 수정</button>
          </div>
          <div className="stat-grid" style={{marginBottom:28}}>
            <StatCard label="모금액" actual={goal?.fundingActual} target={goal?.fundingTarget} format="currency" />
            <StatCard label="협의회 회원 지자체" actual={councilActual} target={goal?.councilTarget} format="count" />
            <StatCard label="위기브 입점 지자체" actual={wegiveActual} target={goal?.wegiveTarget} format="count" />
            <StatCard label="위기브페이 입점 지자체" actual={wegivepayActual} target={goal?.wegivepayTarget} format="count" />
            <StatCard label="위기브페이 발행액" actual={goal?.currencyActual} target={goal?.currencyTarget} format="currency" />
            <StatCard label="매출액" actual={revenueActual} target={goal?.revenueTarget} format="currency" />
          </div>
        </>
      )}
    </>
  );
}

function Dashboard(props) {
  const {
    activityFeed,
    annualGoal, editingAnnual, setEditingAnnual, annualDraft, setAnnualDraft, onSaveAnnualGoal,
    selectedMonth, setSelectedMonth,
    monthlyGoal, editingMonthly, setEditingMonthly, monthlyDraft, setMonthlyDraft, onSaveMonthlyGoal,
    councilOnboardedCount, wegiveOnboardedCount, wegivepayOnboardedCount,
    annualRevenueActual, monthlyRevenueActual,
    monthByCategory, monthByType, savingGoal, onJumpTo,
  } = props;

  const ACTION_LABEL = { history: { created: '히스토리 추가', updated: '히스토리 수정' }, contract: { created: '용역 등록', updated: '용역 수정' } };

  return (
    <div>
      <PeriodGoalSection
        label={`연간 목표 · ${currentYear()}년`}
        goal={annualGoal} editing={editingAnnual} setEditing={setEditingAnnual}
        draft={annualDraft} setDraft={setAnnualDraft} onSave={onSaveAnnualGoal}
        councilActual={councilOnboardedCount} wegiveActual={wegiveOnboardedCount} wegivepayActual={wegivepayOnboardedCount}
        revenueActual={annualRevenueActual}
        savingGoal={savingGoal}
      />

      <div className="section-title">월별 목표</div>
      <div className="filter-row">
        {MONTH_LABELS.map((label, i) => (
          <button key={label} className={`filter-chip ${selectedMonth===i+1?'active':''}`} onClick={() => setSelectedMonth(i+1)}>{label}</button>
        ))}
      </div>
      <PeriodGoalSection
        label={`${selectedMonth}월 목표`}
        goal={monthlyGoal} editing={editingMonthly} setEditing={setEditingMonthly}
        draft={monthlyDraft} setDraft={setMonthlyDraft} onSave={onSaveMonthlyGoal}
        councilActual={councilOnboardedCount} wegiveActual={wegiveOnboardedCount} wegivepayActual={wegivepayOnboardedCount}
        revenueActual={monthlyRevenueActual}
        savingGoal={savingGoal}
      />

      <div className="section-title">{selectedMonth}월 히스토리 요약 (자동 집계)</div>
      <div className="stage-grid" style={{marginBottom:24}}>
        <div className="stage-card">
          <div className="stage-card-label">사업별 히스토리 건수</div>
          {HISTORY_CATEGORIES.map(c => (
            <div key={c.label} className="icon-row"><span className="pill" style={{background:c.color, color:'#fff'}}>{c.label}</span> {monthByCategory[c.label] || 0}건</div>
          ))}
        </div>
        <div className="stage-card">
          <div className="stage-card-label">유형별 히스토리 건수</div>
          {HISTORY_TYPES.map(t => (
            <div key={t} className="icon-row">{t}: {monthByType[t] || 0}건</div>
          ))}
        </div>
      </div>

      <div className="section-title">최근 7일 활동</div>
      {activityFeed.length === 0 ? (
        <div style={{fontSize:13, color:'#6B7280'}}>최근 7일간 기록된 활동이 없어요.</div>
      ) : activityFeed.map(a => {
        const Icon = a.kind === 'contract' ? FileText : (HISTORY_TYPE_ICON[a.type] || Circle);
        const catColor = categoryColorFor(a.category);
        const label = (ACTION_LABEL[a.kind] || {})[a.action] || '업데이트';
        return (
          <div key={a.id} className="history-entry" style={{cursor:'pointer'}} onClick={() => onJumpTo(a.muniId, a.kind)}>
            <div className="history-icon" style={{background: catColor + '22'}}><Icon size={14} color={catColor}/></div>
            <div className="history-body">
              <div className="meta-pills">
                <span className="pill" style={{background: catColor, color:'#fff'}}>{a.muniName || '지자체'}</span>
                {a.category && <span className="pill pill-type">{a.category}</span>}
                <span className="pill pill-type">{label}</span>
                {a.author && <span className="pill pill-author"><User size={11}/> {a.author}</span>}
                <span className="pill pill-date"><Clock size={11}/> {a.at?.toDate ? a.at.toDate().toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : ''}</span>
              </div>
              <div className="content">{a.summary}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value, icon, full }) {
  return (
    <div className="info-field" style={full ? {gridColumn:'1 / -1'} : {}}>
      <label>{label}</label>
      <div className={`val ${!value ? 'empty' : ''} icon-row`}>{icon}{value || '입력된 정보 없음'}</div>
    </div>
  );
}

function MuniForm({ data, setData, onSubmit, onCancel, isEditing, saving }) {
  const set = (k,v) => setData({...data, [k]: v});
  return (
    <form onSubmit={onSubmit}>
      <div className="detail-header">
        <h2 className="brand-heading">{isEditing ? '지자체 정보 수정' : '신규 지자체 등록'}</h2>
        <button type="button" className="btn-secondary" onClick={onCancel}><X size={14}/> 취소</button>
      </div>

      <div className="section-title">기본 정보</div>
      <div className="form-grid">
        <div className="form-field"><label>지자체명 *</label><input value={data.name} onChange={e=>set('name', e.target.value)} placeholder="예: 양구군" required /></div>
        <div className="form-field"><label>광역시도</label><select value={data.region} onChange={e=>set('region', e.target.value)}>{REGIONS.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
        <div className="form-field"><label>단체장 이름</label><input value={data.headName} onChange={e=>set('headName', e.target.value)} /></div>
        <div className="form-field"><label>소속 정당</label><input value={data.party} onChange={e=>set('party', e.target.value)} /></div>
        <div className="form-field"><label>선수</label>
          <select value={data.termCount} onChange={e=>set('termCount', e.target.value)}>{TERM_OPTIONS.map(t=><option key={t} value={t}>{t}</option>)}</select>
        </div>
      </div>

      <div className="section-title">업무별 담당자</div>
      <div className="form-grid">
        {TRACKS.map(t => (
          <React.Fragment key={t.key}>
            <div className="form-field"><label>{t.label} 담당 부서</label><input value={data[`${t.contactPrefix}Dept`]} onChange={e=>set(`${t.contactPrefix}Dept`, e.target.value)} placeholder="예: 정책기획과" /></div>
            <div className="form-field"><label>{t.label} 담당자</label><input value={data[`${t.contactPrefix}ContactName`]} onChange={e=>set(`${t.contactPrefix}ContactName`, e.target.value)} /></div>
            <div className="form-field"><label>{t.label} 직책</label><input value={data[`${t.contactPrefix}ContactPosition`]} onChange={e=>set(`${t.contactPrefix}ContactPosition`, e.target.value)} placeholder="예: 주무관, 팀장" /></div>
            <div className="form-field"><label>{t.label} 연락처</label><input value={data[`${t.contactPrefix}ContactPhone`]} onChange={e=>set(`${t.contactPrefix}ContactPhone`, e.target.value)} placeholder="000-0000-0000" /></div>
            <div className="form-field full"><label>{t.label} 이메일</label><input value={data[`${t.contactPrefix}ContactEmail`]} onChange={e=>set(`${t.contactPrefix}ContactEmail`, e.target.value)} /></div>
          </React.Fragment>
        ))}
      </div>

      <div className="section-title">추진 현황</div>
      <div className="form-grid">
        {TRACKS.map(t => (
          <div className="form-field" key={t.key}>
            <label>{t.label} 단계</label>
            <select value={data[t.key]} onChange={e=>set(t.key, e.target.value)}>
              {t.stages.map(s=><option key={s.value} value={s.value}>{s.value}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="section-title">고향사랑기부제 모금 현황</div>
      <div className="form-grid">
        <div className="form-field"><label>작년 총 모금액</label><input value={data.fundingLastYearTotal} onChange={e=>set('fundingLastYearTotal', e.target.value)} placeholder="예: 3억 2천만원" /></div>
        <div className="form-field"><label>작년 위기브 모금액</label><input value={data.fundingLastYearWegive} onChange={e=>set('fundingLastYearWegive', e.target.value)} /></div>
        <div className="form-field"><label>올해 목표액</label><input value={data.fundingThisYearTarget} onChange={e=>set('fundingThisYearTarget', e.target.value)} /></div>
      </div>

      <div className="section-title">지역화폐 발행 현황</div>
      <div className="form-grid">
        <div className="form-field"><label>작년 총 발행액</label><input value={data.currencyLastYearTotal} onChange={e=>set('currencyLastYearTotal', e.target.value)} /></div>
        <div className="form-field"><label>올해 발행 예정액</label><input value={data.currencyThisYearPlanned} onChange={e=>set('currencyThisYearPlanned', e.target.value)} /></div>
        <div className="form-field"><label>위기브페이 발행액</label><input value={data.currencyWegivepayAmount} onChange={e=>set('currencyWegivepayAmount', e.target.value)} /></div>
      </div>

      <div className="section-title">비고</div>
      <div className="form-grid">
        <div className="form-field full"><textarea value={data.memo} onChange={e=>set('memo', e.target.value)} placeholder="지역 특성, 주요 이슈, 참고사항 등" /></div>
      </div>

      <div className="form-actions">
        <button className="btn-primary" type="submit" disabled={saving}><Save size={14}/> {saving ? '저장 중…' : '저장'}</button>
      </div>
    </form>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');

      :root {
        --primary: #163A5C;      /* 공감만세 네이비 */
        --primary-dark: #0D263D;
        --primary-light: #F0F5FA;
        --accent: #E8503C;       /* 공감만세 레드 */
        --accent-hover: #D43F2A;
        --text-main: #1E293B;
        --text-muted: #64748B;
        --bg-app: #F8FAFC;
        --surface: #FFFFFF;
        --border: #E2E8F0;
        --radius-lg: 16px;
        --radius-md: 12px;
        --radius-sm: 8px;
        --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
        --shadow-md: 0 10px 15px -3px rgb(0 0 0 / 0.08);
      }

      html, body, #root { height: 100%; margin: 0; }

      body {
        font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
        background-color: var(--bg-app);
        color: var(--text-main);
        -webkit-font-smoothing: antialiased;
      }

      .gate-screen { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; text-align:center; padding:24px; background:white; }
      .gate-screen h2 { font-weight:800; color:var(--primary); font-size:24px; margin:0; }
      .gate-screen p { margin:0; color:var(--text-muted); font-size:13px; line-height:1.6; }

      .app-root { min-height:100vh; display:flex; flex-direction:column; }
      .brand-heading { font-weight:800; letter-spacing:-0.03em; }

      .app-header { padding:14px 28px; background:var(--primary); color:white; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; box-shadow:var(--shadow); z-index:50; }
      .app-title { display:flex; align-items:center; gap:12px; }
      .app-title h1 { font-size:19px; color:white; margin:0; }
      .app-title p { font-size:11px; color:rgba(255,255,255,0.6); margin-top:2px; }
      .app-title svg { color:white !important; }

      .search-wrap { position:relative; flex:1; max-width:320px; min-width:160px; }
      .search-wrap input { width:100%; padding:9px 12px 9px 36px; border:none; border-radius:var(--radius-sm); font-size:13px; background:rgba(255,255,255,0.15); color:white; transition:all 0.2s; box-sizing:border-box; }
      .search-wrap input::placeholder { color:rgba(255,255,255,0.5); }
      .search-wrap input:focus { background:rgba(255,255,255,0.25); outline:none; }
      .search-wrap svg { position:absolute; left:11px; top:50%; transform:translateY(-50%); color:rgba(255,255,255,0.5); }

      .btn-primary { background:var(--accent); color:white; border:none; padding:10px 18px; border-radius:var(--radius-sm); font-size:13px; font-weight:700; display:flex; align-items:center; gap:6px; cursor:pointer; transition:all 0.2s; box-shadow:0 2px 4px rgba(232,80,60,0.2); white-space:nowrap; }
      .btn-primary:hover { background:var(--accent-hover); transform:translateY(-1px); }
      .btn-primary:disabled { opacity:0.6; cursor:default; transform:none; }

      .btn-secondary { background:rgba(255,255,255,0.1); color:white; border:1px solid rgba(255,255,255,0.2); padding:9px 15px; border-radius:var(--radius-sm); font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; cursor:pointer; }
      .btn-secondary:hover { background:rgba(255,255,255,0.2); }
      /* 상세 화면 안에서 쓰는 보조 버튼은 밝은 배경 위에 있으므로 어두운 톤으로 */
      .detail .btn-secondary, .history-form .btn-secondary { background:var(--surface); color:var(--primary); border:1px solid var(--border); }
      .detail .btn-secondary:hover, .history-form .btn-secondary:hover { background:var(--bg-app); }

      .btn-danger { background:transparent; color:#ef4444; border:1px solid #fee2e2; padding:8px 14px; border-radius:var(--radius-sm); font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; cursor:pointer; }
      .btn-danger:hover { background:#fef2f2; }

      .app-grid { display:grid; grid-template-columns:320px 1fr; flex:1; min-height:0; }

      .sidebar { background:white; border-right:1px solid var(--border); overflow-y:auto; padding:12px 0; }
      .muni-item { margin:4px 12px; padding:16px; border-radius:var(--radius-md); cursor:pointer; transition:all 0.2s; border:1px solid transparent; display:flex; flex-direction:column; gap:4px; }
      .muni-item:hover { background:var(--bg-app); }
      .muni-item.active { background:var(--primary-light); border-color:rgba(22,58,92,0.1); }
      .muni-item .name { font-weight:700; font-size:15px; color:var(--primary); }
      .muni-item .region { font-size:12px; color:var(--text-muted); margin-bottom:8px; }

      .mini-stamp-row { display:flex; flex-wrap:wrap; gap:4px; margin-top:2px; }
      .mini-stamp { border-radius:4px; padding:2px 6px; font-size:10px; font-weight:800; color:white; white-space:nowrap; }
      .stamp { display:inline-flex; align-items:center; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:800; color:white; box-shadow:0 2px 4px rgba(0,0,0,0.1); width:fit-content; }

      .detail { overflow-y:auto; padding:32px 40px; }
      .empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-muted); gap:10px; padding:40px; text-align:center; height:100%; }

      .section-title { font-size:14px; font-weight:800; color:var(--primary); margin:40px 0 16px; display:flex; align-items:center; gap:8px; text-transform:none; }
      .section-title::before { content:''; width:4px; height:16px; background:var(--accent); border-radius:2px; }

      .detail-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; gap:12px; flex-wrap:wrap; }
      .detail-title { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .detail-title h2 { font-size:22px; margin:0; color:var(--primary); }

      .tabs { display:flex; gap:24px; border-bottom:1px solid var(--border); margin-bottom:24px; flex-wrap:wrap; }
      .tab-btn { padding:12px 4px; background:none; border:none; font-size:14px; font-weight:700; color:var(--text-muted); cursor:pointer; border-bottom:3px solid transparent; }
      .tab-btn.active { color:var(--accent); border-bottom-color:var(--accent); }

      .info-grid { display:grid; grid-template-columns:repeat(2, 1fr); gap:20px; background:white; padding:24px; border-radius:var(--radius-lg); border:1px solid var(--border); }
      .info-field { display:flex; flex-direction:column; gap:3px; }
      .info-field label { font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:6px; letter-spacing:0.03em; }
      .info-field .val { font-size:15px; font-weight:600; color:var(--primary); }
      .info-field .val.empty { color:var(--text-muted); font-style:italic; font-weight:400; }

      .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
      .form-field { display:flex; flex-direction:column; gap:6px; }
      .form-field.full { grid-column:1 / -1; }
      .form-field label { font-size:13px; font-weight:700; color:var(--primary); }
      .form-field input, .form-field select, .form-field textarea { padding:10px 14px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:14px; font-family:inherit; background:var(--surface); box-sizing:border-box; }
      .form-field input:focus, .form-field select:focus, .form-field textarea:focus { border-color:var(--primary); outline:none; box-shadow:0 0 0 3px rgba(22,58,92,0.1); }
      .form-field textarea { resize:vertical; min-height:60px; }
      .form-actions { display:flex; gap:10px; margin-top:20px; align-items:center; }

      .history-form { background:#F1F5F9; border-radius:var(--radius-lg); padding:24px; margin-bottom:24px; border:1px solid var(--border); }
      .editing-badge { display:inline-block; background:var(--accent); color:#fff; font-size:11px; font-weight:700; padding:3px 9px; border-radius:5px; margin-bottom:10px; }

      .history-entry { background:white; display:flex; gap:14px; padding:18px; border-radius:var(--radius-md); border:1px solid var(--border); margin-bottom:12px; box-shadow:var(--shadow); }
      .history-icon { width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      .history-body { flex:1; min-width:0; }
      .history-entry .content { font-size:13px; line-height:1.6; white-space:pre-wrap; color:var(--text-main); }
      .history-actions { display:flex; gap:4px; align-items:center; flex-shrink:0; }
      .icon-btn { background:none; border:none; color:var(--text-muted); cursor:pointer; padding:6px; border-radius:var(--radius-sm); display:flex; }
      .icon-btn:hover { background:var(--bg-app); color:var(--primary); }

      .filter-row { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
      .filter-chip { padding:6px 14px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid var(--border); background:var(--surface); cursor:pointer; color:var(--text-muted); }
      .filter-chip.active { background:var(--primary); color:#fff; border-color:var(--primary); }

      .meta-pills { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
      .pill { font-size:11px; font-weight:800; padding:4px 10px; border-radius:6px; display:inline-flex; align-items:center; gap:4px; }
      .pill-date { background:var(--primary-light); color:var(--primary); }
      .pill-type { background:#F1F5F9; color:var(--text-muted); }
      .pill-author { background:#F1F5F9; color:var(--text-muted); }

      .error-banner { background:#fef2f2; color:#dc2626; border:1px solid #fee2e2; border-radius:var(--radius-sm); padding:10px 16px; margin:16px 28px 0; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; }

      .icon-row { display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:6px; font-weight:500; color:var(--text-main); }
      .icon-row svg { color:var(--text-muted); flex-shrink:0; }

      .total-line { font-size:14px; font-weight:800; color:var(--primary); margin-bottom:14px; }

      .goal-card { background:white; border:1px solid var(--border); border-radius:var(--radius-md); padding:16px; box-shadow:var(--shadow); }
      .goal-card-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; font-size:13px; }
      .goal-meta { color:var(--text-muted); font-size:12px; }

      .goal-bar-track { height:8px; background:#E2E8F0; border-radius:10px; margin-top:14px; overflow:hidden; }
      .goal-bar-fill { height:100%; border-radius:10px; background:linear-gradient(90deg, var(--primary), var(--accent)) !important; }

      .stat-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; }
      .stat-card { background:white; border-radius:var(--radius-lg); padding:24px; box-shadow:var(--shadow); border:1px solid var(--border); transition:transform 0.2s; }
      .stat-card:hover { transform:translateY(-4px); box-shadow:var(--shadow-md); }
      .stat-label { font-size:13px; font-weight:700; color:var(--text-muted); margin-bottom:12px; }
      .stat-value { font-size:32px; font-weight:800; color:var(--primary); letter-spacing:-0.04em; }
      .stat-target { font-size:14px; color:var(--text-muted); margin-top:8px; font-weight:600; }
      .stat-status { font-size:13px; font-weight:700; margin-top:8px; }

      .stage-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; }
      .stage-card { background:white; border:1px solid var(--border); border-radius:var(--radius-md); padding:18px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:8px; }
      .stage-card-label { font-size:12px; font-weight:800; color:var(--primary); margin-bottom:4px; }

      .contract-table { display:flex; flex-direction:column; border:1px solid var(--border); border-radius:var(--radius-md); overflow:hidden; background:white; box-shadow:var(--shadow); }
      .contract-row { display:grid; grid-template-columns:1fr 2fr 0.7fr 1fr 1.2fr 0.6fr; gap:8px; padding:12px 16px; font-size:13px; align-items:center; border-bottom:1px solid var(--border); }
      .contract-row:last-child { border-bottom:none; }
      .contract-row.contract-head { background:var(--bg-app); font-weight:700; font-size:11px; color:var(--text-muted); text-transform:uppercase; }
      .contract-row .muted { color:var(--text-muted); }

      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .back-btn { display:none; }

      @media (max-width: 1024px) {
        .app-grid { grid-template-columns:1fr; }
        .app-root.has-selection .sidebar { display:none; }
        .app-root:not(.has-selection) .detail { display:none; }
        .detail { padding:20px 18px; }
        .info-grid, .form-grid { grid-template-columns:1fr; }
        .stage-grid, .stat-grid { grid-template-columns:1fr; }
        .contract-row { grid-template-columns:1fr; }
        .back-btn { display:flex; margin-bottom:14px; }
      }
    `}</style>
  );
}
