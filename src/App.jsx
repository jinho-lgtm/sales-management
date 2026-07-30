import React, { useState, useEffect } from 'react';
import {
  Building2, Search, Plus, X, Save, Phone, Mail, MapPin, User, Edit3, Trash2,
  ChevronLeft, Loader2, Clock, AlertCircle, LogOut, Video, FileText, Circle, Download, Home,
} from 'lucide-react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy, where, serverTimestamp, getDocs,
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
    councilDept: '', councilContactName: '', councilContactPhone: '', councilContactEmail: '',
    wegiveDept: '', wegiveContactName: '', wegiveContactPhone: '', wegiveContactEmail: '',
    wegivepayDept: '', wegivepayContactName: '', wegivepayContactPhone: '', wegivepayContactEmail: '',
    councilStage: '제안 완료', wegiveStage: '제안 완료', wegivepayStage: '제안 완료',
    fundingLastYearTotal: '', fundingLastYearWegive: '', fundingThisYearTarget: '',
    currencyLastYearTotal: '', currencyThisYearPlanned: '', currencyWegivepayAmount: '',
    memo: '',
  };
}

function emptyHistoryDraft(defaultAuthor) {
  return { category: HISTORY_CATEGORIES[0].label, date: new Date().toISOString().slice(0, 10), type: '방문', author: defaultAuthor || '', content: '' };
}

function emptyContractDraft() {
  return { category: CONTRACT_CATEGORIES[0], name: '', year: String(new Date().getFullYear()), amount: '', memo: '' };
}

// 연간/월간 목표 문서 키
function currentYear() { return new Date().getFullYear(); }
function currentMonth() { return new Date().getMonth() + 1; }
function monthlyGoalId(year, month) { return `${year}-${month}`; }
function emptyMonthlyDraft() { return { title: '', category: '전체', target: '' }; }
function emptyAnnualDraft() { return { title: '', category: '전체', target: '' }; }
function emptyKeyActivityDraft() { return { label: '', category: '전체', historyType: '전체', targetCount: '' }; }
function uid2() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

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
      <h2 className="serif">지자체 영업/대관 관리</h2>
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
      <h2 className="serif">접근 권한이 없어요</h2>
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
  const [activityRaw, setActivityRaw] = useState([]);
  const [yearActivity, setYearActivity] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [annualGoal, setAnnualGoal] = useState(null);
  const [monthlyGoal, setMonthlyGoal] = useState(null);
  const [editingAnnual, setEditingAnnual] = useState(false);
  const [annualDraft, setAnnualDraft] = useState(emptyAnnualDraft());
  const [editingMonthly, setEditingMonthly] = useState(false);
  const [monthlyDraft, setMonthlyDraft] = useState(emptyMonthlyDraft());
  const [keyActivityDraft, setKeyActivityDraft] = useState(emptyKeyActivityDraft());
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
      setContracts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
    const yearStart = new Date(currentYear(), 0, 1);
    const q = query(collection(db, 'activity'), where('at', '>=', yearStart));
    const unsub = onSnapshot(q, snap => {
      setYearActivity(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => a.kind === 'history' && a.action === 'created'));
    }, err => setError(`연간 활동 데이터를 불러오지 못했어요 (${err.message}).`));
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
    if (!annualDraft.title.trim()) { setError('연간 목표 내용을 입력해주세요.'); return; }
    setSavingGoal(true);
    setError('');
    try {
      await setDoc(doc(db, 'annualGoals', String(currentYear())), {
        year: currentYear(), title: annualDraft.title.trim(), category: annualDraft.category,
        target: Number(annualDraft.target) || 0, updatedBy: user.displayName || user.email, updatedAt: serverTimestamp(),
      }, { merge: true });
      setEditingAnnual(false);
    } catch (e) {
      setError(`연간 목표 저장에 실패했어요 (${e.message}).`);
    }
    setSavingGoal(false);
  }

  async function handleSaveMonthlyGoal(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!monthlyDraft.title.trim()) { setError('월간 목표 내용을 입력해주세요.'); return; }
    setSavingGoal(true);
    setError('');
    const id = monthlyGoalId(currentYear(), selectedMonth);
    const payload = {
      year: currentYear(), month: selectedMonth, title: monthlyDraft.title.trim(), category: monthlyDraft.category,
      target: Number(monthlyDraft.target) || 0, keyActivities: monthlyGoal?.keyActivities || [],
      updatedBy: user.displayName || user.email, updatedAt: serverTimestamp(),
    };
    try {
      await setDocSafe(id, payload);
      setEditingMonthly(false);
    } catch (e) {
      setError(`월간 목표 저장에 실패했어요 (${e.message}).`);
    }
    setSavingGoal(false);
  }

  // monthlyGoals 문서가 없을 수도 있으므로 setDoc(merge)로 항상 안전하게 저장한다.
  async function setDocSafe(id, payload) {
    await setDoc(doc(db, 'monthlyGoals', id), payload, { merge: true });
  }

  async function handleAddKeyActivity(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!keyActivityDraft.label.trim()) { setError('핵심활동 이름을 입력해주세요.'); return; }
    setSavingGoal(true);
    setError('');
    const id = monthlyGoalId(currentYear(), selectedMonth);
    const newItem = { id: uid2(), label: keyActivityDraft.label.trim(), category: keyActivityDraft.category, historyType: keyActivityDraft.historyType, targetCount: Number(keyActivityDraft.targetCount) || 0 };
    const nextActivities = [...(monthlyGoal?.keyActivities || []), newItem];
    try {
      await setDocSafe(id, {
        year: currentYear(), month: selectedMonth,
        title: monthlyGoal?.title || '', category: monthlyGoal?.category || '전체', target: monthlyGoal?.target || 0,
        keyActivities: nextActivities, updatedBy: user.displayName || user.email, updatedAt: serverTimestamp(),
      });
      setKeyActivityDraft(emptyKeyActivityDraft());
    } catch (e) {
      setError(`핵심활동 저장에 실패했어요 (${e.message}).`);
    }
    setSavingGoal(false);
  }

  async function handleDeleteKeyActivity(itemId) {
    if (!window.confirm('이 핵심활동을 삭제할까요?')) return;
    const id = monthlyGoalId(currentYear(), selectedMonth);
    const nextActivities = (monthlyGoal?.keyActivities || []).filter(k => k.id !== itemId);
    try {
      await setDocSafe(id, { ...monthlyGoal, keyActivities: nextActivities, updatedBy: user.displayName || user.email, updatedAt: serverTimestamp() });
    } catch (e) {
      setError(`핵심활동 삭제에 실패했어요 (${e.message}).`);
    }
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
    try {
      if (editingHistoryId) {
        await updateDoc(doc(db, 'municipalities', selectedId, 'history', editingHistoryId), payload);
      } else {
        await addDoc(collection(db, 'municipalities', selectedId, 'history'), { ...payload, createdAt: serverTimestamp() });
      }
      logActivity({
        muniId: selectedId, muniName: detail?.name || '', kind: 'history', category: payload.category, type: payload.type,
        action: editingHistoryId ? 'updated' : 'created', summary: payload.content.slice(0, 60),
        author: payload.author || user.displayName || user.email,
      });
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
    } catch (e) {
      setError(`히스토리 삭제에 실패했어요 (${e.message}).`);
    }
  }

  // ---- 용역 ----
  function startEditContract(c) {
    setEditingContractId(c.id);
    setContractDraft({ category: c.category, name: c.name, year: c.year, amount: c.amount, memo: c.memo || '' });
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
    const payload = { ...contractDraft, name: contractDraft.name.trim(), amount: Number(contractDraft.amount) || 0 };
    try {
      if (editingContractId) {
        await updateDoc(doc(db, 'municipalities', selectedId, 'contracts', editingContractId), payload);
      } else {
        await addDoc(collection(db, 'municipalities', selectedId, 'contracts'), { ...payload, createdAt: serverTimestamp() });
      }
      logActivity({
        muniId: selectedId, muniName: detail?.name || '', kind: 'contract', category: payload.category,
        action: editingContractId ? 'updated' : 'created',
        summary: `${payload.name} (${Number(payload.amount || 0).toLocaleString('ko-KR')}원)`,
        author: user.displayName || user.email,
      });
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
  const monthActivity = yearActivity.filter(a => {
    const t = a.at?.toDate ? a.at.toDate() : null;
    return t && t.getFullYear() === currentYear() && (t.getMonth() + 1) === selectedMonth;
  });
  const monthByCategory = {};
  const monthByType = {};
  monthActivity.forEach(a => {
    if (a.category) monthByCategory[a.category] = (monthByCategory[a.category] || 0) + 1;
    if (a.type) monthByType[a.type] = (monthByType[a.type] || 0) + 1;
  });
  const monthlyGoalCount = monthActivity.filter(a => !monthlyGoal?.category || monthlyGoal.category === '전체' || a.category === monthlyGoal.category).length;
  const annualGoalCount = yearActivity.filter(a => !annualGoal?.category || annualGoal.category === '전체' || a.category === annualGoal.category).length;
  const keyActivitiesWithCount = (monthlyGoal?.keyActivities || []).map(k => ({
    ...k,
    count: monthActivity.filter(a =>
      (k.category === '전체' || a.category === k.category) &&
      (k.historyType === '전체' || a.type === k.historyType)
    ).length,
  }));

  return (
    <div className={`app-root ${selectedId || showForm ? 'has-selection' : ''}`}>
      <GlobalStyle />
      <div className="app-header">
        <div className="app-title" style={{cursor:'pointer'}} onClick={() => { setSelectedId(null); setShowForm(false); }}>
          <Building2 size={22} color="#1C2B45" />
          <div>
            <h1 className="serif">지자체 영업/대관 관리</h1>
            <p>공감만세 사업본부 · 전사 공유 · 총 {munis.length}개 지자체 · {user.email}</p>
          </div>
        </div>
        <div className="search-wrap">
          <Search size={15} />
          <input placeholder="지자체명 또는 지역 검색" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-secondary" onClick={() => { setSelectedId(null); setShowForm(false); }}><Home size={14}/> 대시보드</button>
        <button className="btn-secondary" onClick={handleExportAll} disabled={exporting || munis.length===0}><Download size={14}/> {exporting ? '내보내는 중…' : '백업 다운로드'}</button>
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
                  <span key={t.key} className="mini-stamp" style={{color: stageColorFor(t, m[t.key])}} title={`${t.label}: ${m[t.key] || '제안 완료'}`}>
                    {t.short} {m[t.key] || '제안 완료'}
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
              annualGoalCount={annualGoalCount}
              selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth}
              monthlyGoal={monthlyGoal} editingMonthly={editingMonthly} setEditingMonthly={setEditingMonthly}
              monthlyDraft={monthlyDraft} setMonthlyDraft={setMonthlyDraft} onSaveMonthlyGoal={handleSaveMonthlyGoal}
              monthlyGoalCount={monthlyGoalCount}
              keyActivities={keyActivitiesWithCount}
              keyActivityDraft={keyActivityDraft} setKeyActivityDraft={setKeyActivityDraft}
              onAddKeyActivity={handleAddKeyActivity} onDeleteKeyActivity={handleDeleteKeyActivity}
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
                  <h2 className="serif">{detail.name}</h2>
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
                        <div className="icon-row"><User size={13}/>{detail[`${t.contactPrefix}ContactName`] || '미입력'}</div>
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
                        <span className="stamp" style={{color: stageColorFor(t, detail[t.key])}}>{detail[t.key] || '제안 완료'}</span>
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
                        <label>계약연도</label>
                        <input value={contractDraft.year} onChange={e => setContractDraft({...contractDraft, year:e.target.value})} placeholder="예: 2026" />
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
                        <span>구분</span><span>용역명</span><span>연도</span><span>계약금액</span><span>비고</span><span></span>
                      </div>
                      {contracts.map(c => (
                        <div key={c.id} className="contract-row">
                          <span>{c.category}</span>
                          <span>{c.name}</span>
                          <span>{c.year}</span>
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

function Dashboard(props) {
  const {
    activityFeed,
    annualGoal, editingAnnual, setEditingAnnual, annualDraft, setAnnualDraft, onSaveAnnualGoal, annualGoalCount,
    selectedMonth, setSelectedMonth,
    monthlyGoal, editingMonthly, setEditingMonthly, monthlyDraft, setMonthlyDraft, onSaveMonthlyGoal, monthlyGoalCount,
    keyActivities, keyActivityDraft, setKeyActivityDraft, onAddKeyActivity, onDeleteKeyActivity,
    monthByCategory, monthByType, savingGoal, onJumpTo,
  } = props;

  const ACTION_LABEL = { history: { created: '히스토리 추가', updated: '히스토리 수정' }, contract: { created: '용역 등록', updated: '용역 수정' } };

  function openAnnualEdit() {
    setAnnualDraft(annualGoal ? { title: annualGoal.title, category: annualGoal.category, target: annualGoal.target || '' } : emptyAnnualDraft());
    setEditingAnnual(true);
  }
  function openMonthlyEdit() {
    setMonthlyDraft(monthlyGoal ? { title: monthlyGoal.title, category: monthlyGoal.category, target: monthlyGoal.target || '' } : emptyMonthlyDraft());
    setEditingMonthly(true);
  }

  return (
    <div>
      <div className="section-title">연간 목표 · {currentYear()}년</div>
      {editingAnnual ? (
        <form className="history-form" onSubmit={onSaveAnnualGoal}>
          <div className="form-grid">
            <div className="form-field full"><label>연간 목표</label><input value={annualDraft.title} onChange={e=>setAnnualDraft({...annualDraft, title:e.target.value})} placeholder="예: 위기브 전국 100개 지자체 입점" /></div>
            <div className="form-field"><label>사업</label>
              <select value={annualDraft.category} onChange={e=>setAnnualDraft({...annualDraft, category:e.target.value})}>
                <option value="전체">전체</option>
                {HISTORY_CATEGORIES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-field"><label>목표 건수</label><input type="number" value={annualDraft.target} onChange={e=>setAnnualDraft({...annualDraft, target:e.target.value})} placeholder="예: 100" /></div>
          </div>
          <div className="form-actions">
            <button className="btn-primary" type="submit" disabled={savingGoal}><Save size={14}/> {savingGoal ? '저장 중…' : '저장'}</button>
            <button type="button" className="btn-secondary" onClick={() => setEditingAnnual(false)}><X size={14}/> 취소</button>
          </div>
        </form>
      ) : annualGoal ? (
        <div className="goal-card" style={{marginBottom:24}}>
          <div className="goal-card-top">
            <div>
              <strong>{annualGoal.title}</strong>
              <span className="goal-meta"> · {annualGoal.category}{annualGoal.target > 0 && ` · ${annualGoalCount}/${annualGoal.target}건`}</span>
            </div>
            <button className="btn-secondary" onClick={openAnnualEdit}><Edit3 size={13}/> 수정</button>
          </div>
          <GoalBar count={annualGoalCount} target={annualGoal.target} />
        </div>
      ) : (
        <div style={{marginBottom:24}}>
          <div style={{fontSize:13, color:'#6B7280', marginBottom:8}}>아직 {currentYear()}년 연간 목표가 없어요.</div>
          <button className="btn-secondary" onClick={openAnnualEdit}><Plus size={13}/> 연간 목표 설정</button>
        </div>
      )}

      <div className="section-title">월별 목표</div>
      <div className="filter-row">
        {MONTH_LABELS.map((label, i) => (
          <button key={label} className={`filter-chip ${selectedMonth===i+1?'active':''}`} onClick={() => setSelectedMonth(i+1)}>{label}</button>
        ))}
      </div>

      {editingMonthly ? (
        <form className="history-form" onSubmit={onSaveMonthlyGoal}>
          <div className="form-grid">
            <div className="form-field full"><label>{selectedMonth}월 목표</label><input value={monthlyDraft.title} onChange={e=>setMonthlyDraft({...monthlyDraft, title:e.target.value})} placeholder="예: 협의회 신규 제안 5개 지자체" /></div>
            <div className="form-field"><label>사업</label>
              <select value={monthlyDraft.category} onChange={e=>setMonthlyDraft({...monthlyDraft, category:e.target.value})}>
                <option value="전체">전체</option>
                {HISTORY_CATEGORIES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-field"><label>목표 건수</label><input type="number" value={monthlyDraft.target} onChange={e=>setMonthlyDraft({...monthlyDraft, target:e.target.value})} placeholder="예: 5" /></div>
          </div>
          <div className="form-actions">
            <button className="btn-primary" type="submit" disabled={savingGoal}><Save size={14}/> {savingGoal ? '저장 중…' : '저장'}</button>
            <button type="button" className="btn-secondary" onClick={() => setEditingMonthly(false)}><X size={14}/> 취소</button>
          </div>
        </form>
      ) : monthlyGoal?.title ? (
        <div className="goal-card" style={{marginBottom:16}}>
          <div className="goal-card-top">
            <div>
              <strong>{monthlyGoal.title}</strong>
              <span className="goal-meta"> · {monthlyGoal.category}{monthlyGoal.target > 0 && ` · ${monthlyGoalCount}/${monthlyGoal.target}건`}</span>
            </div>
            <button className="btn-secondary" onClick={openMonthlyEdit}><Edit3 size={13}/> 수정</button>
          </div>
          <GoalBar count={monthlyGoalCount} target={monthlyGoal.target} />
        </div>
      ) : (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:13, color:'#6B7280', marginBottom:8}}>{selectedMonth}월 목표가 아직 없어요.</div>
          <button className="btn-secondary" onClick={openMonthlyEdit}><Plus size={13}/> {selectedMonth}월 목표 설정</button>
        </div>
      )}

      <div className="section-title">핵심활동 ({selectedMonth}월)</div>
      <form className="history-form" onSubmit={onAddKeyActivity}>
        <div className="form-grid">
          <div className="form-field full"><label>핵심활동 이름</label><input value={keyActivityDraft.label} onChange={e=>setKeyActivityDraft({...keyActivityDraft, label:e.target.value})} placeholder="예: 지자체 방문" /></div>
          <div className="form-field"><label>사업</label>
            <select value={keyActivityDraft.category} onChange={e=>setKeyActivityDraft({...keyActivityDraft, category:e.target.value})}>
              <option value="전체">전체</option>
              {HISTORY_CATEGORIES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
            </select>
          </div>
          <div className="form-field"><label>활동 유형</label>
            <select value={keyActivityDraft.historyType} onChange={e=>setKeyActivityDraft({...keyActivityDraft, historyType:e.target.value})}>
              <option value="전체">전체</option>
              {HISTORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-field"><label>목표 건수</label><input type="number" value={keyActivityDraft.targetCount} onChange={e=>setKeyActivityDraft({...keyActivityDraft, targetCount:e.target.value})} placeholder="예: 10" /></div>
        </div>
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={savingGoal}><Plus size={14}/> {savingGoal ? '저장 중…' : '핵심활동 추가'}</button>
        </div>
      </form>

      {keyActivities.length === 0 ? (
        <div style={{fontSize:13, color:'#6B7280', marginBottom:24}}>등록된 핵심활동이 없어요. 히스토리 입력 시 자동으로 건수가 집계돼요.</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:10, marginBottom:28}}>
          {keyActivities.map(k => (
            <div key={k.id} className="goal-card">
              <div className="goal-card-top">
                <div>
                  <strong>{k.label}</strong>
                  <span className="goal-meta"> · {k.category} · {k.historyType}{k.targetCount > 0 && ` · ${k.count}/${k.targetCount}건`}</span>
                </div>
                <button className="icon-btn" onClick={() => onDeleteKeyActivity(k.id)} title="삭제"><Trash2 size={13}/></button>
              </div>
              <GoalBar count={k.count} target={k.targetCount} />
            </div>
          ))}
        </div>
      )}

      <div className="section-title">{selectedMonth}월 활동 요약 (자동 집계)</div>
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
        <h2 className="serif">{isEditing ? '지자체 정보 수정' : '신규 지자체 등록'}</h2>
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
      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&display=swap');
      html, body, #root { height: 100%; margin: 0; }
      .gate-screen { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; font-family:'Noto Sans KR',sans-serif; text-align:center; padding:24px; background:#F5F3EE; color:#1E2430; }
      .gate-screen h2 { margin:0; font-size:20px; }
      .gate-screen p { margin:0; color:#6B7280; font-size:13px; line-height:1.6; }
      .app-root { --bg:#F5F3EE; --surface:#FFFFFF; --primary:#1C2B45; --primary-dark:#10192B; --accent:#B8862E;
        --text:#1E2430; --text-muted:#6B7280; --border:#E4E0D6; --danger:#A6453A;
        font-family:'Noto Sans KR',sans-serif; background:var(--bg); color:var(--text);
        min-height:100vh; display:flex; flex-direction:column; }
      .serif { font-family:'Noto Serif KR', serif; }
      .app-header { padding:18px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; background:var(--surface); }
      .app-title { display:flex; align-items:center; gap:10px; }
      .app-title h1 { font-size:18px; font-weight:700; margin:0; letter-spacing:-0.01em; }
      .app-title p { font-size:12px; color:var(--text-muted); margin:2px 0 0; }
      .search-wrap { position:relative; flex:1; max-width:300px; min-width:160px; }
      .search-wrap input { width:100%; padding:8px 12px 8px 34px; border:1px solid var(--border); border-radius:8px; font-size:13px; background:var(--bg); box-sizing:border-box; }
      .search-wrap svg { position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--text-muted); }
      .btn-primary { background:var(--primary); color:#fff; border:none; padding:9px 16px; border-radius:8px; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; cursor:pointer; white-space:nowrap; }
      .btn-primary:hover { background:var(--primary-dark); }
      .btn-primary:disabled { opacity:0.6; cursor:default; }
      .btn-secondary { background:transparent; color:var(--primary); border:1px solid var(--border); padding:8px 14px; border-radius:8px; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; cursor:pointer; }
      .btn-secondary:hover { background:var(--bg); }
      .btn-danger { background:transparent; color:var(--danger); border:1px solid var(--border); padding:8px 12px; border-radius:8px; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; cursor:pointer; }
      .app-grid { display:grid; grid-template-columns:300px 1fr; flex:1; min-height:0; }
      .sidebar { border-right:1px solid var(--border); overflow-y:auto; background:var(--surface); }
      .muni-item { padding:13px 18px; border-bottom:1px solid var(--border); cursor:pointer; display:flex; flex-direction:column; gap:4px; }
      .muni-item:hover { background:var(--bg); }
      .muni-item.active { background:#EFEBE0; }
      .muni-item .name { font-weight:600; font-size:14px; }
      .muni-item .region { font-size:12px; color:var(--text-muted); }
      .stamp { display:inline-flex; align-items:center; justify-self:start; border:1.5px solid currentColor; border-radius:5px; padding:1px 7px; font-size:10px; font-weight:700; letter-spacing:0.06em; transform:rotate(-2deg); width:fit-content; }
      .mini-stamp-row { display:flex; flex-wrap:wrap; gap:4px; margin-top:2px; }
      .mini-stamp { border:1px solid currentColor; border-radius:4px; padding:0px 5px; font-size:9px; font-weight:700; letter-spacing:0.02em; white-space:nowrap; }
      .stage-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; }
      .stage-card { border:1px solid var(--border); border-radius:9px; padding:12px 14px; background:var(--surface); display:flex; flex-direction:column; gap:8px; }
      .stage-card-label { font-size:12px; font-weight:600; color:var(--text); line-height:1.3; }
      .detail { overflow-y:auto; padding:22px 30px; }
      .empty-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-muted); gap:10px; padding:40px; text-align:center; height:100%; }
      .detail-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; gap:12px; flex-wrap:wrap; }
      .detail-title { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .detail-title h2 { font-size:21px; margin:0; }
      .tabs { display:flex; gap:0; border-bottom:1px solid var(--border); margin-bottom:20px; flex-wrap:wrap; }
      .tab-btn { padding:9px 4px; margin-right:22px; background:none; border:none; font-size:13px; font-weight:600; color:var(--text-muted); cursor:pointer; border-bottom:2px solid transparent; }
      .tab-btn.active { color:var(--primary); border-bottom-color:var(--accent); }
      .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 24px; }
      .info-field { display:flex; flex-direction:column; gap:3px; }
      .info-field label { font-size:11px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.03em; }
      .info-field .val { font-size:14px; }
      .info-field .val.empty { color:var(--text-muted); font-style:italic; }
      .section-title { font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin:22px 0 10px; }
      .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
      .form-field { display:flex; flex-direction:column; gap:5px; }
      .form-field.full { grid-column:1 / -1; }
      .form-field label { font-size:12px; font-weight:600; color:var(--text); }
      .form-field input, .form-field select, .form-field textarea { padding:8px 10px; border:1px solid var(--border); border-radius:7px; font-size:13px; font-family:inherit; background:var(--surface); box-sizing:border-box; }
      .form-field textarea { resize:vertical; min-height:60px; }
      .form-actions { display:flex; gap:10px; margin-top:20px; align-items:center; }
      .history-form { background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:20px; }
      .editing-badge { display:inline-block; background:var(--accent); color:#fff; font-size:11px; font-weight:700; padding:3px 9px; border-radius:5px; margin-bottom:10px; }
      .history-entry { display:flex; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); }
      .history-icon { width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
      .history-body { flex:1; min-width:0; }
      .history-entry .meta { font-size:11px; color:var(--text-muted); font-weight:600; margin-bottom:3px; display:flex; gap:6px; align-items:center; }
      .history-entry .content { font-size:13px; line-height:1.5; white-space:pre-wrap; }
      .history-actions { display:flex; gap:4px; align-items:center; flex-shrink:0; }
      .icon-btn { background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px; border-radius:5px; display:flex; }
      .icon-btn:hover { background:var(--bg); color:var(--primary); }
      .filter-row { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
      .filter-chip { padding:5px 12px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid var(--border); background:var(--surface); cursor:pointer; color:var(--text-muted); }
      .filter-chip.active { background:var(--primary); color:#fff; border-color:var(--primary); }
      .meta-pills { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; }
      .pill { display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:700; padding:3px 9px; border-radius:20px; }
      .pill-date { background:#EFEBE0; color:var(--text); }
      .pill-type { background:#EDEDED; color:var(--text-muted); }
      .pill-author { background:#E8EDF3; color:var(--primary); }
      .error-banner { background:#FBEDEA; color:var(--danger); padding:8px 14px; border-radius:8px; font-size:12px; margin:12px 24px 0; display:flex; align-items:center; gap:6px; }
      .icon-row { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text); }
      .icon-row svg { color:var(--text-muted); flex-shrink:0; }
      .total-line { font-size:13px; font-weight:700; color:var(--primary); margin-bottom:12px; }
      .goal-card { border:1px solid var(--border); border-radius:9px; padding:12px 14px; background:var(--surface); }
      .goal-card-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; font-size:13px; }
      .goal-meta { color:var(--text-muted); font-size:12px; }
      .goal-bar-track { background:var(--bg); border-radius:20px; height:7px; margin-top:8px; overflow:hidden; }
      .goal-bar-fill { height:100%; border-radius:20px; transition:width 0.3s; }
      .contract-table { display:flex; flex-direction:column; border:1px solid var(--border); border-radius:9px; overflow:hidden; }
      .contract-row { display:grid; grid-template-columns:1fr 2fr 0.7fr 1fr 1.2fr 0.6fr; gap:8px; padding:10px 12px; font-size:13px; align-items:center; border-bottom:1px solid var(--border); }
      .contract-row:last-child { border-bottom:none; }
      .contract-row.contract-head { background:var(--bg); font-weight:700; font-size:11px; color:var(--text-muted); text-transform:uppercase; }
      .contract-row .muted { color:var(--text-muted); }
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .back-btn { display:none; }
      @media (max-width: 768px) {
        .app-grid { grid-template-columns:1fr; }
        .app-root.has-selection .sidebar { display:none; }
        .app-root:not(.has-selection) .detail { display:none; }
        .detail { padding:18px 16px; }
        .info-grid, .form-grid { grid-template-columns:1fr; }
        .stage-grid { grid-template-columns:1fr; }
        .contract-row { grid-template-columns:1fr; }
        .back-btn { display:flex; margin-bottom:14px; }
      }
    `}</style>
  );
}
