import React, { useState, useEffect } from 'react';
import { Building2, Search, Plus, X, Save, Phone, Mail, MapPin, User, Edit3, Trash2, ChevronLeft, Loader2, Clock, AlertCircle, LogOut } from 'lucide-react';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider, db, ALLOWED_EMAIL_DOMAIN } from './firebase';

const REGIONS = ['서울특별시','부산광역시','대구광역시','인천광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전남광주통합특별시','경상북도','경상남도','제주특별자치도'];

const STAGE_OPTIONS = [
  { value: '리드', color: '#8A8F98' },
  { value: '협의중', color: '#B8862E' },
  { value: 'MOU체결', color: '#2C6E5E' },
  { value: '운영중', color: '#3F7A57' },
  { value: '휴면', color: '#A6453A' },
];

const TRACKS = [
  { key: 'councilStage', label: '지속가능관광지방정부협의회', short: '협의회' },
  { key: 'wegiveStage', label: '위기브(고향사랑기부제)', short: '위기브' },
  { key: 'wegivepayStage', label: '위기브페이', short: '위기브페이' },
];

const HISTORY_TYPES = ['방문','전화','이메일','화상미팅','내부검토','기타'];

function stageColor(stage) {
  const found = STAGE_OPTIONS.find(s => s.value === stage);
  return found ? found.color : '#8A8F98';
}

function emptyMuni() {
  return {
    name: '', region: REGIONS[0], population: '', dept: '', contactName: '', contactPhone: '', contactEmail: '',
    councilStage: '리드', wegiveStage: '리드', wegivepayStage: '리드', recentFunding: '', memo: '',
  };
}

// ---------- 인증 ----------

function useAuthUser() {
  const [user, setUser] = useState(undefined); // undefined = 확인 중, null = 로그아웃 상태
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

function SignInScreen() {
  const [signingIn, setSigningIn] = useState(false);
  const [err, setErr] = useState('');
  async function handleSignIn() {
    setSigningIn(true);
    setErr('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setErr('로그인에 실패했어요. 다시 시도해주세요.');
    }
    setSigningIn(false);
  }
  return (
    <div className="gate-screen">
      <Building2 size={40} strokeWidth={1.2} />
      <h2 className="serif">지자체 영업/대관 관리</h2>
      <p>회사 구글 계정으로 로그인하면 이용할 수 있어요.</p>
      {err && <div className="error-banner"><AlertCircle size={14}/> {err}</div>}
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
  const user = useAuthUser();
  if (user === undefined) {
    return <div className="gate-screen"><Loader2 size={28} className="spin" /></div>;
  }
  if (!user) return <SignInScreen />;
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
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(emptyMuni());
  const [isEditing, setIsEditing] = useState(false);
  const [tab, setTab] = useState('info');
  const [historyDraft, setHistoryDraft] = useState({ date: new Date().toISOString().slice(0,10), type: '방문', author: user.displayName || '', content: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const detail = munis.find(m => m.id === selectedId) || null;

  // 지자체 목록 실시간 구독 - 누군가 추가/수정하면 모두에게 즉시 반영됨
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

  // 선택된 지자체의 영업 히스토리 실시간 구독
  useEffect(() => {
    if (!selectedId) { setHistory([]); return; }
    setLoadingHistory(true);
    const q = query(collection(db, 'municipalities', selectedId, 'history'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingHistory(false);
    }, err => {
      setError(`히스토리를 불러오지 못했어요 (${err.message}).`);
      setLoadingHistory(false);
    });
    return unsub;
  }, [selectedId]);

  function openAddForm() {
    setFormData(emptyMuni());
    setIsEditing(false);
    setShowForm(true);
    setSelectedId(null);
  }

  function openEditForm() {
    if (!detail) return;
    setFormData(detail);
    setIsEditing(true);
    setShowForm(true);
  }

  async function handleSaveForm(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.name.trim()) { setError('지자체명을 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    const record = {
      ...formData,
      name: formData.name.trim(),
      updatedAt: serverTimestamp(),
      updatedBy: user.displayName || user.email,
    };
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
    if (!window.confirm(`'${detail.name}' 항목을 삭제할까요? 영업 히스토리도 함께 삭제됩니다.`)) return;
    setError('');
    try {
      await deleteDoc(doc(db, 'municipalities', selectedId));
      setSelectedId(null);
    } catch (e) {
      setError(`삭제에 실패했어요 (${e.message}).`);
    }
  }

  async function handleAddHistory(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!historyDraft.content.trim()) { setError('내용을 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      await addDoc(collection(db, 'municipalities', selectedId, 'history'), {
        ...historyDraft,
        content: historyDraft.content.trim(),
        createdAt: serverTimestamp(),
      });
      setHistoryDraft({ date: new Date().toISOString().slice(0,10), type: '방문', author: user.displayName || '', content: '' });
    } catch (e) {
      setError(`히스토리 저장에 실패했어요 (${e.message}). 입력한 내용은 남아있으니 다시 시도해보세요.`);
    }
    setSaving(false);
  }

  const filtered = munis.filter(m => m.name.includes(search) || (m.region || '').includes(search));

  return (
    <div className={`app-root ${selectedId || showForm ? 'has-selection' : ''}`}>
      <GlobalStyle />
      <div className="app-header">
        <div className="app-title">
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
        <button className="btn-secondary" onClick={() => signOut(auth)}><LogOut size={14}/> 로그아웃</button>
        <button className="btn-primary" onClick={openAddForm}><Plus size={15}/> 신규 지자체</button>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={14}/> {error}
        </div>
      )}

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
                  <span key={t.key} className="mini-stamp" style={{color: stageColor(m[t.key])}} title={`${t.label}: ${m[t.key] || '리드'}`}>
                    {t.short} {m[t.key] || '리드'}
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
            <div className="empty-state">
              <Building2 size={36} strokeWidth={1.2} />
              <p>왼쪽 목록에서 지자체를 선택하거나<br/>신규 지자체를 등록해보세요.</p>
            </div>
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
              </div>

              {tab === 'info' ? (
                <>
                  <div className="section-title">기본 정보</div>
                  <div className="info-grid">
                    <Field label="지역" value={detail.region} icon={<MapPin size={13}/>} />
                    <Field label="인구 규모" value={detail.population} />
                    <Field label="담당 부서" value={detail.dept} />
                    <Field label="담당자" value={detail.contactName} icon={<User size={13}/>} />
                    <Field label="연락처" value={detail.contactPhone} icon={<Phone size={13}/>} />
                    <Field label="이메일" value={detail.contactEmail} icon={<Mail size={13}/>} />
                  </div>
                  <div className="section-title">추진 현황</div>
                  <div className="stage-grid">
                    {TRACKS.map(t => (
                      <div key={t.key} className="stage-card">
                        <div className="stage-card-label">{t.label}</div>
                        <span className="stamp" style={{color: stageColor(detail[t.key])}}>{detail[t.key] || '리드'}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:14}}><Field label="최근 모금 현황" value={detail.recentFunding} full /></div>
                  <div style={{marginTop:14}}><Field label="비고" value={detail.memo} full /></div>
                </>
              ) : (
                <>
                  <form className="history-form" onSubmit={handleAddHistory}>
                    <div className="form-grid">
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
                        <label>내용</label>
                        <textarea value={historyDraft.content} onChange={e => setHistoryDraft({...historyDraft, content:e.target.value})} placeholder="미팅/통화 내용, 논의 사항, 다음 액션 등을 기록하세요." />
                      </div>
                    </div>
                    <div className="form-actions">
                      <button className="btn-primary" type="submit" disabled={saving}><Save size={14}/> {saving ? '저장 중…' : '히스토리 추가'}</button>
                    </div>
                  </form>

                  {loadingHistory ? (
                    <div style={{fontSize:13, color:'#6B7280'}}>불러오는 중…</div>
                  ) : history.length === 0 ? (
                    <div style={{fontSize:13, color:'#6B7280'}}>아직 기록된 영업 히스토리가 없어요.</div>
                  ) : history.map(h => (
                    <div key={h.id} className="history-entry">
                      <div className="meta"><Clock size={11}/> {h.date} · {h.type} {h.author && `· ${h.author}`}</div>
                      <div className="content">{h.content}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
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
        <div className="form-field"><label>인구 규모</label><input value={data.population} onChange={e=>set('population', e.target.value)} placeholder="예: 약 2만명" /></div>
        <div className="form-field"><label>담당 부서</label><input value={data.dept} onChange={e=>set('dept', e.target.value)} placeholder="예: 정책기획과" /></div>
        <div className="form-field"><label>담당자</label><input value={data.contactName} onChange={e=>set('contactName', e.target.value)} /></div>
        <div className="form-field"><label>연락처</label><input value={data.contactPhone} onChange={e=>set('contactPhone', e.target.value)} placeholder="000-0000-0000" /></div>
        <div className="form-field"><label>이메일</label><input value={data.contactEmail} onChange={e=>set('contactEmail', e.target.value)} /></div>
      </div>
      <div className="section-title">추진 현황</div>
      <div className="form-grid">
        {TRACKS.map(t => (
          <div className="form-field" key={t.key}>
            <label>{t.label} 단계</label>
            <select value={data[t.key]} onChange={e=>set(t.key, e.target.value)}>
              {STAGE_OPTIONS.map(s=><option key={s.value} value={s.value}>{s.value}</option>)}
            </select>
          </div>
        ))}
        <div className="form-field full"><label>최근 모금 현황</label><textarea value={data.recentFunding} onChange={e=>set('recentFunding', e.target.value)} placeholder="최근 모금액, 제휴처 순위 등 자유롭게 기록" /></div>
        <div className="form-field full"><label>비고</label><textarea value={data.memo} onChange={e=>set('memo', e.target.value)} placeholder="지역 특성, 주요 이슈, 참고사항 등" /></div>
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
      .tabs { display:flex; gap:0; border-bottom:1px solid var(--border); margin-bottom:20px; }
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
      .form-actions { display:flex; gap:10px; margin-top:20px; }
      .history-form { background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:20px; }
      .history-entry { border-left:2px solid var(--border); padding:2px 0 16px 16px; position:relative; }
      .history-entry::before { content:''; position:absolute; left:-5px; top:5px; width:8px; height:8px; border-radius:50%; background:var(--accent); }
      .history-entry .meta { font-size:11px; color:var(--text-muted); font-weight:600; margin-bottom:3px; display:flex; gap:8px; align-items:center; }
      .history-entry .content { font-size:13px; line-height:1.5; }
      .error-banner { background:#FBEDEA; color:var(--danger); padding:8px 14px; border-radius:8px; font-size:12px; margin:12px 24px 0; display:flex; align-items:center; gap:6px; }
      .icon-row { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text); }
      .icon-row svg { color:var(--text-muted); flex-shrink:0; }
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
        .back-btn { display:flex; margin-bottom:14px; }
      }
    `}</style>
  );
}
