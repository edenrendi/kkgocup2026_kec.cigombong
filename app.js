/* =========================================================================
   BADMINTIME TOURNAMENT MANAGEMENT SYSTEM
   Single-file app. DB = localStorage (badmintime_db_v1)
   Struktur DB dirancang agar field-nya siap dipetakan 1:1 ke Google Sheet
   (PESERTA, TEAM, JADWAL, LAGA, HASIL, LOG_AKTIVITAS, PENGATURAN) melalui
   Google Apps Script. Lihat syncToGoogleSheet() dan tombol "Unduh Code.gs"
   di menu Pengaturan.
   ========================================================================= */

const STORAGE_KEY = 'badmintime_db_v1';
const SESSION_KEY = 'badmintime_session_v1';

/* ---------- URL backend bawaan (dari config.js) ----------
   Sebelumnya URL Apps Script hanya tersimpan di localStorage tiap perangkat,
   jadi perangkat/browser yang baru pertama kali membuka link GitHub Pages
   TIDAK tahu URL backend-nya (kosong) dan tidak pernah menarik data dari
   cloud -> terlihat seperti "data hilang / balik ke awal". resolvedGasUrl_()
   membaca URL yang sudah ditempel admin di config.js (satu kali, saat
   deploy) supaya SEMUA pengunjung otomatis tersambung ke database yang sama. */
function resolvedGasUrl_(){
  try{
    if(typeof GAS_WEB_APP_URL === 'string'){
      const u = GAS_WEB_APP_URL.trim();
      if(u && u.indexOf('TEMPEL_URL_WEB_APP_ANDA_DI_SINI') === -1 && /^https:\/\/script\.google(usercontent)?\.com\//.test(u)){
        return u;
      }
    }
  }catch(e){ /* config.js belum dimuat / belum dibuat, abaikan */ }
  return '';
}

/* ---------- SAFE_STORAGE: pembungkus localStorage agar tidak macet ----------
   Saat aplikasi dibuka di dalam iframe Google Apps Script (script.googleusercontent.com),
   browser modern (terutama Chrome) kadang MEMBLOKIR akses localStorage untuk iframe
   pihak ketiga (SecurityError). Kalau akses localStorage dibiarkan tanpa try/catch,
   satu error saja akan menghentikan seluruh skrip sebelum sempat menyembunyikan
   layar loading, sehingga aplikasi terlihat "macet muter" selamanya.
   SAFE_STORAGE otomatis fallback ke penyimpanan sementara di memori (_memStore)
   kalau localStorage tidak bisa diakses, supaya aplikasi tetap bisa dipakai
   (data tetap tersinkron ke cloud lewat Google Sheet/Drive kalau URL Apps Script
   sudah diatur; hanya saja tidak otomatis tersimpan permanen di browser tsb). */
const SAFE_STORAGE = (function(){
  let _memStore = {};
  let _usable = false;
  try{
    const testKey = '__badmintime_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    _usable = true;
  }catch(e){ _usable = false; }
  return {
    getItem(key){
      if(_usable){ try{ return localStorage.getItem(key); }catch(e){ _usable=false; } }
      return Object.prototype.hasOwnProperty.call(_memStore, key) ? _memStore[key] : null;
    },
    setItem(key, value){
      if(_usable){ try{ localStorage.setItem(key, value); return; }catch(e){ _usable=false; } }
      _memStore[key] = value;
    },
    removeItem(key){
      if(_usable){ try{ localStorage.removeItem(key); }catch(e){ _usable=false; } }
      delete _memStore[key];
    }
  };
})();

const KATEGORI = [
  {id:'tunggal_putra', nama:'Tunggal Putra', jumlahPemain:1},
  {id:'tunggal_putri', nama:'Tunggal Putri', jumlahPemain:1},
  {id:'ganda_putra', nama:'Ganda Putra', jumlahPemain:2},
  {id:'ganda_putri', nama:'Ganda Putri', jumlahPemain:2},
  {id:'mix_double', nama:'Mix Double', jumlahPemain:2},
];

const ROLES = [
  {id:'admin', label:'Administrator', icon:'fa-user-shield'},
];
const DEMO_USERS = [
  {username:'admin', password:'admin', role:'admin', nama:'Administrator'},
];
const DEFAULT_TEAM_NAMES = ['TEAM A','TEAM B','TEAM C','TEAM D','TEAM E','TEAM F','TEAM G','TEAM H'];
const JERSEY_COLORS = ['#E1122F','#2563EB','#059669','#D97706','#7C3AED','#0891B2','#DB2777','#0F766E'];

function uid(p){ return (p||'id')+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function nowTime(){ return new Date().toTimeString().slice(0,5); }
function escapeHtml(s){ return ((s===undefined||s===null)?'':s).toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
/* Helper pengganti optional chaining (?.) / nullish coalescing (??) yang tidak
   didukung oleh parser panel otorisasi Google Apps Script (userCodeAppPanel),
   supaya deployment tidak gagal dengan "SyntaxError: missing ) after argument list". */
function hasClass_(selectorOrId, cls, isSelector){
  var el = isSelector ? document.querySelector(selectorOrId) : document.getElementById(selectorOrId);
  return !!(el && el.classList && el.classList.contains(cls));
}
function firstDefined_(){
  for(var i=0;i<arguments.length;i++){ if(arguments[i]!==undefined && arguments[i]!==null) return arguments[i]; }
  return undefined;
}
function fmtDate(iso){ if(!iso) return '-'; const d=new Date(iso+'T00:00:00'); const M=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']; return isNaN(d)?iso:(d.getDate()+' '+M[d.getMonth()]+' '+d.getFullYear()); }
function kategoriNama(id){ return (KATEGORI.find(k=>k.id===id)||{}).nama||id; }
const KATEGORI_COLORS = {
  tunggal_putra:{bg:'#EFF6FF',border:'#2563EB',text:'#1D4ED8',dark:'#0F2B5C'},
  tunggal_putri:{bg:'#FDF2F8',border:'#DB2777',text:'#BE185D',dark:'#5A1238'},
  ganda_putra:{bg:'#ECFDF5',border:'#059669',text:'#047857',dark:'#0C4638'},
  ganda_putri:{bg:'#FFF7ED',border:'#EA580C',text:'#C2410C',dark:'#5A220B'},
  mix_double:{bg:'#F5F3FF',border:'#7C3AED',text:'#6D28D9',dark:'#321568'}
};
const GUGUS_COLORS = ['#E1122F','#2563EB','#059669','#D97706','#7C3AED','#0891B2','#DB2777','#475569'];
function gugusColor(g){ const i=Math.max(0,DB.gugus.indexOf(g)); return GUGUS_COLORS[i%GUGUS_COLORS.length]; }
function teamColor(id){ const t=DB.teams.find(x=>x.id===id); return (t && t.warna) || '#64748B'; }
function teamSlotName(t){ return t.slotKey ? ('TEAM '+t.slotKey) : (t.slotLabel||t.nama); }
function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

/* ---------- Seed / Load DB ---------- */
function seedDB(){
  const teams = DEFAULT_TEAM_NAMES.map((n,i)=>({id:uid('team'), nama:n, slotLabel:n, slotKey:String.fromCharCode(65+i), logo:'', koordinator:'', warna:JERSEY_COLORS[i], poin:0, gugus:'', statusPendaftaran:''}));
  return {
    users: DEMO_USERS.slice(),
    gugus: ['Gugus 1','Gugus 2','Gugus 3','Gugus 4'],
    teams,
    peserta: [],
    laga: [],
    baganMeta: { generated:false, order:[] },
    juaraTeamId: null,
    logs: [ mkLog('Sistem','Aplikasi BADMINTIME diinisialisasi') ],
    settings: {
      namaTurnamen: '<span class="badmintime-title">BADMINTIME Tournament</span> 2026',
      logoUrl: '',
      tanggalMulai: todayISO(),
      tanggalSelesai: todayISO(),
      lokasi: 'GOR Kecamatan Cigombong',
      jumlahLapangan: 2,
      kategoriAktif: KATEGORI.map(k=>k.id),
      gasUrl: resolvedGasUrl_(),
      sessionTimeoutMin: 20,
      waNumber: '',
      waMessage: 'Halo Admin, saya ingin bertanya tentang turnamen.',
      youtubeChannelUrl: '',
      youtubeVideos: [],
      pendaftaranDibuka: '',
      pendaftaranDitutup: '',
      batasBayarTanggal: '',
      thbUrl: '',
      thbFileName: '',
      tampilkanNamaPemainJadwal: true
    }
  };
}
function mkLog(jenis, ket){ return {id:uid('log'), waktu:new Date().toISOString(), jenis, ket, user: (typeof currentUser!=='undefined' && currentUser)? currentUser.nama : 'Sistem'}; }

let DB = null;
function applyDBDefaults(){
  if(!DB.settings) DB.settings = seedDB().settings;
  if(DB.settings.waNumber===undefined) DB.settings.waNumber='';
  if(DB.settings.waMessage===undefined) DB.settings.waMessage='Halo Admin, saya ingin bertanya tentang turnamen.';
  if(DB.settings.youtubeChannelUrl===undefined) DB.settings.youtubeChannelUrl='';
  if(!Array.isArray(DB.settings.youtubeVideos)) DB.settings.youtubeVideos=[];
  if(DB.settings.pendaftaranDibuka===undefined) DB.settings.pendaftaranDibuka='';
  if(DB.settings.pendaftaranDitutup===undefined) DB.settings.pendaftaranDitutup='';
  if(DB.settings.batasBayarTanggal===undefined) DB.settings.batasBayarTanggal='';
  if(DB.settings.thbUrl===undefined) DB.settings.thbUrl='';
  if(DB.settings.thbFileName===undefined) DB.settings.thbFileName='';
  if(DB.settings.gasUrl===undefined) DB.settings.gasUrl='';
  /* Selalu selaraskan dengan config.js kalau sudah diisi admin: ini yang
     membuat SEMUA perangkat (bukan cuma yang pernah isi URL manual di
     Pengaturan) otomatis tersambung ke backend yang sama setiap kali
     aplikasi dibuka, termasuk browser yang baru pertama kali membuka link. */
  const _cfgUrl = resolvedGasUrl_();
  if(_cfgUrl) DB.settings.gasUrl = _cfgUrl;
  if(DB.settings.tampilkanNamaPemainJadwal===undefined) DB.settings.tampilkanNamaPemainJadwal=true;
  if(!DB.baganMeta) DB.baganMeta = { generated:false, order:[] };
  if(!Array.isArray(DB.gugus)) DB.gugus = ['Gugus 1','Gugus 2'];
  if(DB.juaraTeamId===undefined) DB.juaraTeamId = null;
  (DB.teams||[]).forEach((t,i)=>{
    if(!t.slotKey) t.slotKey = i<26 ? String.fromCharCode(65+i) : '';
    if(!t.slotLabel || !/^TEAM [A-Z]$/.test(t.slotLabel)) t.slotLabel = t.slotKey ? ('TEAM '+t.slotKey) : t.slotLabel;
    if(t.gugus===undefined) t.gugus='';
    if(t.statusPendaftaran===undefined) t.statusPendaftaran='';
  });
}
function loadDB(){
  try{
    const raw = SAFE_STORAGE.getItem(STORAGE_KEY);
    DB = raw ? JSON.parse(raw) : seedDB();
  }catch(e){ DB = seedDB(); }
  applyDBDefaults();
  saveDB();
  /* Jika URL Apps Script sudah diatur, tarik data terbaru dari Google Sheet/
     Drive supaya semua perangkat yang membuka link ini melihat data yang sama. */
  if(cloudSyncEnabled()) pullDBFromCloud(true);
}
function saveDB(){
  SAFE_STORAGE.setItem(STORAGE_KEY, JSON.stringify(DB));
  window._settingsDirty=false;
  /* PERBAIKAN: catat kapan terakhir kali ada perubahan LOKAL yang disimpan.
     Dipakai oleh pullDBFromCloud() untuk mendeteksi & membuang hasil tarikan
     data dari server yang sudah BASI (dikirim SEBELUM perubahan ini dibuat),
     supaya video/perubahan yang baru saja disimpan admin tidak tertimpa
     balik oleh data lama begitu tarikan yang lambat itu akhirnya selesai.
     Lihat penjelasan lengkap di pullDBFromCloud(). */
  window._lastLocalChangeAt = Date.now();
  scheduleCloudPush();
}
function addLog(jenis, ket){ DB.logs.unshift(mkLog(jenis, ket)); DB.logs = DB.logs.slice(0,200); saveDB(); }

/* ---------- Google Apps Script Sync (legacy, per-entitas satu arah) ---------- */
async function syncToGoogleSheet(sheet, action, data){
  const url = DB.settings.gasUrl;
  if(!url) return {ok:false, reason:'GAS URL belum diatur'};
  try{
    await fetch(url, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({sheet, action, data, timestamp:new Date().toISOString()}) });
    return {ok:true};
  }catch(e){ return {ok:false, reason:e.message}; }
}

/* ---------- Cloud Sync utama: seluruh DB tersimpan di Google Sheet + Google Drive ----------
   Membuat aplikasi ini bisa dibuka online oleh siapa saja (HP/laptop) lewat satu link, dengan
   data yang sama untuk semua orang. Lihat Code.gs (menu Pengaturan > Unduh Code.gs). */
let _cloudPushTimer = null;
let _cloudPushing = false;
let _cloudPulling = false;
window._cloudStatus = { state:'idle', lastSyncAt:null, lastError:null };
window._lastLocalChangeAt = 0;

/* ---------- Lindungi form yang sedang diisi tapi belum disimpan ----------
   BUG YANG DIPERBAIKI: sebelumnya, kalau admin sedang mengisi form (mis.
   menambah beberapa link video YouTube satu per satu, yang perlu pindah ke
   aplikasi/tab lain untuk menyalin tiap link), begitu admin kembali ke tab
   ini, aplikasi otomatis menarik data terbaru dari server (autoPullIfSafe_)
   dan me-render ULANG seluruh halaman Pengaturan dari data server -- yang
   MENIMPA/MENGHAPUS isian yang sudah diketik tapi belum diklik "Simpan".
   Makanya terasa seperti "link tiba-tiba hilang, harus diulang".
   window._settingsDirty menandai "ada isian form yang belum disimpan" --
   diset true begitu admin mengetik apa pun di dalam panel admin (#app),
   dan direset ke false setiap kali saveDB() dipanggil (yaitu setiap admin
   benar-benar mengklik tombol "Simpan"). Selama dirty=true, penarikan data
   otomatis di latar belakang DITUNDA, supaya isian yang belum disimpan
   tidak pernah tertimpa. */
window._settingsDirty = false;
document.addEventListener('input', function(e){
  if(e.target && e.target.closest && e.target.closest('#app')) window._settingsDirty = true;
}, true);

function cloudSyncEnabled(){ return !!(DB && DB.settings && DB.settings.gasUrl); }

function updateCloudStatusUI(){
  document.querySelectorAll('[data-cloud-status]').forEach(el=>{
    const s = window._cloudStatus;
    const map = {
      idle: ['text-zinc-400','fa-circle-notch','Belum tersambung ke cloud'],
      syncing: ['text-amber-500','fa-arrows-rotate fa-spin','Menyinkronkan ke cloud...'],
      success: ['text-emerald-600','fa-circle-check','Tersinkron ke Google Sheet & Drive'],
      error: ['text-red-500','fa-triangle-exclamation','Gagal sinkron: '+(s.lastError||'')]
    };
    const [cls, icon, label] = map[s.state] || map.idle;
    el.className = 'text-xs flex items-center gap-1.5 '+cls;
    el.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(label)}${s.lastSyncAt?` \u00B7 ${new Date(s.lastSyncAt).toLocaleTimeString('id-ID')}`:''}</span>`;
  });
}
function scheduleCloudPush(){
  if(!cloudSyncEnabled()) return;
  /* PERBAIKAN BUG UTAMA "data kembali ke awal": aksi 'savedb' di Code.gs
     MENIMPA SELURUH database di server dengan salinan DB yang ada di
     perangkat ini. Salinan lokal itu hanya "difoto" satu kali (saat
     halaman dibuka / tarikan terakhir), jadi kalau ADA peserta lain yang
     mendaftar atau admin yang mengubah data dari perangkat lain di antara
     saat itu dan saat 'savedb' ini terkirim, perubahan orang lain tsb IKUT
     TERTIMPA/HILANG -- persis gejala "data balik ke awal lagi" setelah ada
     yang input. Sekarang HANYA admin yang sedang login yang boleh memicu
     pengiriman 'savedb' (mis. menyusun jadwal, mengubah skor, pengaturan).
     Perubahan dari PENGUNJUNG PUBLIK yang belum login (pendaftaran peserta
     baru, edit data sendiri) TIDAK lagi lewat jalur ini -- keduanya sudah
     dikirim lewat endpoint atomik terpisah (registerpeserta / updatepeserta
     di Code.gs) yang hanya menambah/mengubah baris miliknya sendiri di
     server, di dalam kunci (lock), tanpa pernah menimpa data orang lain.
     Ini juga berarti pendaftaran peserta TETAP masuk ke server sekalipun
     admin sedang offline / keluar tab / laptopnya mati, karena permintaan
     langsung dikirim dari perangkat peserta itu sendiri ke server -- bukan
     dititipkan lewat perangkat admin. */
  if(!isAdmin()) return;
  clearTimeout(_cloudPushTimer);
  _cloudPushTimer = setTimeout(pushDBToCloud, 1500);
}
async function pushDBToCloud(){
  if(!cloudSyncEnabled() || _cloudPushing) return;
  _cloudPushing = true;
  window._cloudStatus.state='syncing'; updateCloudStatusUI();
  try{
    const res = await fetch(DB.settings.gasUrl, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({action:'savedb', db: DB}) });
    let json = null; try{ json = await res.json(); }catch(e){}
    if(json && json.ok===false) throw new Error(json.error||'Gagal menyimpan ke cloud');
    window._cloudStatus = { state:'success', lastSyncAt:new Date().toISOString(), lastError:null };
    showCloudSaveToast_(true);
  }catch(e){
    window._cloudStatus = { state:'error', lastSyncAt: window._cloudStatus.lastSyncAt, lastError:e.message };
    showCloudSaveToast_(false, e.message);
  } finally {
    _cloudPushing=false;
    _cloudPushTimer=null; /* PERBAIKAN: dulu tidak pernah direset -> autoPullIfSafe_() mengira
      selamanya "masih ada kiriman tertunda" dan tidak pernah menarik data terbaru lagi
      setelah pengiriman pertama ke cloud. */
    updateCloudStatusUI();
  }
}
async function pullDBFromCloud(silent){
  const url = (DB && DB.settings && DB.settings.gasUrl) || '';
  if(!url || _cloudPulling) return;
  _cloudPulling = true;
  if(!silent){ window._cloudStatus.state='syncing'; updateCloudStatusUI(); }
  /* PERBAIKAN BUG UTAMA: catat SAAT tarikan ini mulai. Google Apps Script
     kadang lambat merespons (beberapa detik, apalagi saat "cold start").
     Kalau selama tarikan ini masih berjalan admin sempat mengubah &
     menyimpan sesuatu (mis. menambah link video lalu klik "Simpan"), maka
     begitu tarikan lambat ini akhirnya selesai, datanya sudah BASI --
     dikirim server SEBELUM perubahan admin ada. Dulu, hasil basi ini tetap
     ditimpakan begitu saja ke DB dan localStorage, sehingga video/perubahan
     yang baru saja disimpan admin langsung LENYAP lagi tanpa sebab yang
     terlihat ("hilang sendiri setelah klik Simpan"). Sekarang, kalau
     terbukti ada perubahan lokal yang lebih baru dari saat tarikan ini
     dimulai, hasil tarikan yang basi ini DIBUANG (tidak diterapkan) --
     data lokal yang baru tetap dipakai, dan perubahan itu akan terkirim ke
     server lewat pengiriman (push) yang sudah/akan berjalan seperti biasa. */
  const pullStartedAt = Date.now();
  try{
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetch(url+sep+'action=getdb');
    const json = await res.json();
    if(window._lastLocalChangeAt > pullStartedAt){
      /* Ada perubahan lokal yang dibuat SETELAH tarikan ini mulai -> hasil
         tarikan ini basi, jangan diterapkan supaya tidak menimpa balik
         perubahan yang baru saja disimpan admin. */
      window._cloudStatus = { state:'success', lastSyncAt:new Date().toISOString(), lastError:null };
      return;
    }
    if(json && json.ok && json.db){
      DB = json.db;
      applyDBDefaults();
      SAFE_STORAGE.setItem(STORAGE_KEY, JSON.stringify(DB));
      rerenderCurrentView();
      window._cloudStatus = { state:'success', lastSyncAt:new Date().toISOString(), lastError:null };
    }else if(!silent){
      Swal.fire({toast:true, position:'top-end', icon:'info', title:'Belum ada data tersimpan di cloud', showConfirmButton:false, timer:2000});
    }
  }catch(e){
    window._cloudStatus = { state:'error', lastSyncAt: window._cloudStatus.lastSyncAt, lastError:e.message };
    if(!silent) Swal.fire({icon:'error', title:'Gagal mengambil data dari cloud', text:e.message, confirmButtonColor:'#2563EB'});
  } finally { _cloudPulling=false; updateCloudStatusUI(); }
}
function manualCloudSync(){
  if(!cloudSyncEnabled()){ Swal.fire({icon:'info', title:'URL Apps Script belum diatur', text:'Buka menu Pengaturan > Integrasi Google Apps Script, isi URL /exec terlebih dahulu.', confirmButtonColor:'#2563EB'}); return; }
  if(window._settingsDirty){
    Swal.fire({icon:'warning', title:'Ada isian yang belum disimpan', text:'Klik tombol "Simpan" pada form yang sedang Anda isi terlebih dahulu, supaya isian itu tidak tertimpa data dari server.', confirmButtonColor:'#2563EB'});
    return;
  }
  pullDBFromCloud(false);
}

/* ---------- Notifikasi "tersimpan ke server" ----------
   Toast terpisah dari toast "tersimpan" lokal yang sudah ada di berbagai
   tempat (yang cuma menandakan tersimpan ke localStorage/perangkat ini).
   Toast ini khusus menandakan status pengiriman ke Google Sheet/Drive
   (server utama), supaya admin/peserta tahu pasti datanya sudah sampai ke
   server, bukan cuma tersimpan di HP/laptop masing-masing. Diberi jeda
   minimal supaya tidak spam kalau ada banyak perubahan beruntun. */
let _lastCloudToastAt = 0;
function showCloudSaveToast_(ok, reason){
  const now = Date.now();
  if(ok && now - _lastCloudToastAt < 4000) return;
  _lastCloudToastAt = now;
  if(ok){
    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Tersimpan ke server \u2713', showConfirmButton:false, timer:1800});
  } else {
    Swal.fire({toast:true, position:'top-end', icon:'error', title:'Gagal tersimpan ke server', text: reason || 'Cek koneksi internet, data masih aman di perangkat ini', showConfirmButton:false, timer:3000});
  }
}

/* ---------- Kirim pendaftaran peserta LANGSUNG ke server (atomik) ----------
   Berbeda dari pushDBToCloud() (yang mengirim & MENIMPA seluruh database),
   fungsi ini memanggil endpoint 'registerpeserta' di Code.gs yang HANYA
   MENAMBAHKAN peserta baru ke data yang sudah tersimpan di server, di dalam
   kunci (lock) di sisi server. Ini memastikan:
     - Pendaftaran tetap tersimpan ke server walau admin sedang offline.
     - Kalau banyak peserta mendaftar hampir bersamaan dari HP berbeda,
       pendaftaran tidak saling menimpa (masalah lama pada mekanisme
       "simpan seluruh database" yang bisa membuat pendaftaran salah satu
       peserta hilang tanpa terlihat error apa pun). */
async function registerPesertaToCloud_(pesertaArr, linkedTeam, nomorRegistrasi){
  const url = (DB && DB.settings && DB.settings.gasUrl) || resolvedGasUrl_();
  if(!url) return {ok:false, reason:'URL Apps Script belum diatur di config.js'};
  try{
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({
        action:'registerpeserta',
        peserta: pesertaArr,
        team: linkedTeam ? {id:linkedTeam.id, poin:linkedTeam.poin, statusPendaftaran:linkedTeam.statusPendaftaran} : null,
        nomorRegistrasi
      })
    });
    let json = null; try{ json = await res.json(); }catch(e){}
    if(json && json.ok===false){
      if(json.duplicateGugus) return {ok:false, duplicateGugus:true, reason:json.error};
      throw new Error(json.error||'Gagal menyimpan ke server');
    }
    return {ok:true};
  }catch(e){ return {ok:false, reason:e.message}; }
}

/* ---------- Kirim perbaikan data sendiri (peserta publik) LANGSUNG ke server
   (atomik) ---- sama seperti registerPesertaToCloud_ di atas, tapi memanggil
   endpoint 'updatepeserta': HANYA mengubah baris peserta yang id-nya cocok
   di server, tidak menimpa seluruh database. Dipakai oleh
   savePublicEditedRegistration() supaya peserta yang memperbaiki data
   sendiri (mis. salah ketik nama/sekolah) tetap tersimpan ke server
   sekalipun admin sedang offline, dan tidak menimpa pendaftaran/perubahan
   orang lain yang terjadi hampir bersamaan. */
async function updatePesertaToCloud_(pesertaArr, nomorRegistrasi){
  const url = (DB && DB.settings && DB.settings.gasUrl) || resolvedGasUrl_();
  if(!url) return {ok:false, reason:'URL Apps Script belum diatur di config.js'};
  try{
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ action:'updatepeserta', peserta: pesertaArr, nomorRegistrasi })
    });
    let json = null; try{ json = await res.json(); }catch(e){}
    if(json && json.ok===false) throw new Error(json.error||'Gagal menyimpan ke server');
    return {ok:true};
  }catch(e){ return {ok:false, reason:e.message}; }
}

/* ---------- Auto-refresh berkala ----------
   Supaya perangkat lain (admin/peserta lain) yang sedang membuka layar yang
   sama melihat data terbaru tanpa harus refresh manual. Ditarik otomatis:
   1) tiap beberapa puluh detik selagi tab aktif, dan
   2) setiap kali tab/aplikasi kembali dilihat (habis pindah tab / kembali
      dari mengunci layar HP).
   Ditunda kalau: sedang ada modal/formulir terbuka (supaya tidak menimpa
   apa yang sedang diketik admin), atau sedang ada pengiriman data yang
   masih tertunda (supaya perubahan lokal tidak keburu tertimpa data lama). */
const CLOUD_PULL_INTERVAL_MS = 10000; /* PERBAIKAN: dulu 45 detik -> perubahan admin (mis. ubah
  jumlah/nama Gugus) baru terlihat oleh peserta lain setelah puluhan detik s/d beberapa menit,
  terutama kalau layar peserta sedang tidak aktif/dibackground (throttle browser) lalu baru
  tertangkap saat tab kembali fokus. 10 detik memberi rasa "hampir realtime" tanpa membebani
  kuota eksekusi Apps Script secara berlebihan (lihat juga perbaikan rerenderCurrentView()
  di bawah, supaya hasil tarikan tiap 10 detik ini benar-benar dipakai memperbarui layar). */
function isModalOpen_(){
  const el = document.getElementById('modalRoot');
  return !!(el && el.innerHTML.trim() !== '');
}
function autoPullIfSafe_(){
  if(!cloudSyncEnabled()) return;
  if(_cloudPushing || _cloudPushTimer) return; /* ada perubahan lokal yang belum terkirim */
  if(isModalOpen_()) return; /* jangan ganggu form yang sedang diisi */
  if(window._settingsDirty) return; /* ada isian form (mis. daftar video YouTube) yang belum diklik Simpan -- jangan timpa */
  pullDBFromCloud(true);
}
setInterval(autoPullIfSafe_, CLOUD_PULL_INTERVAL_MS);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') autoPullIfSafe_(); });
window.addEventListener('focus', autoPullIfSafe_);

/* ---------- Selamatkan perubahan terakhir saat tab ditutup ----------
   scheduleCloudPush() menunda pengiriman 1.5 detik (supaya tidak spam
   kirim tiap ketikan). Kalau pengguna menutup tab / pindah halaman persis
   dalam jeda itu, perubahan terakhir bisa belum sempat terkirim. beforeunload
   di bawah mengirim SISA data yang belum terkirim lewat sendBeacon (metode
   pengiriman yang dijamin browser selesaikan walau halaman sudah ditutup). */
window.addEventListener('beforeunload', ()=>{
  if(!cloudSyncEnabled()) return;
  if(!_cloudPushTimer) return; /* tidak ada perubahan tertunda */
  try{
    clearTimeout(_cloudPushTimer);
    const payload = JSON.stringify({action:'savedb', db: DB});
    if(navigator.sendBeacon){
      navigator.sendBeacon(DB.settings.gasUrl, new Blob([payload], {type:'text/plain;charset=utf-8'}));
    }
  }catch(e){ /* biarkan, data tetap ada di localStorage perangkat ini */ }
});
function rerenderCurrentView(){
  try{
    if(currentUser){
      renderBranding();
      const _activeNavEl = document.querySelector('.nav-link.bg-primary');
      const activeId = (_activeNavEl && _activeNavEl.dataset.nav) || 'dashboard';
      navigate(activeId);
    }else if(!hasClass_('landingScreen','hidden')){
      renderLanding();
    }else if(!hasClass_('registerScreen','hidden')){
      /* PERBAIKAN: sebelumnya tarikan data latar belakang (autoPullIfSafe_,
         tiap CLOUD_PULL_INTERVAL_MS) MEMPERBARUI DB di memori tapi TIDAK
         menyentuh layar sama sekali kalau peserta sedang berada di layar
         Formulir Pendaftaran (registerScreen) -- karena rerenderCurrentView()
         dulu hanya menangani layar Beranda (landingScreen) & panel admin.
         Akibatnya pilihan Gugus (dropdown #r_gugus, diisi 1x saat formulir
         dibuka lewat prepRegisterForm) tetap menampilkan daftar Gugus LAMA
         sampai peserta menutup/refresh browser secara manual -- persis
         keluhan "peserta masih baca Gugus 1-4 walau admin sudah ubah jadi 8
         Gugus, baru ke-update setelah refresh manual beberapa menit
         kemudian". Di sini kita HANYA menyegarkan daftar pilihan Gugus di
         dropdown (bukan reset seluruh formulir dengan prepRegisterForm(),
         supaya nama/foto pemain yang sedang diisi peserta tidak ikut hilang
         tertimpa), sambil mempertahankan pilihan yang sudah dipilih peserta
         kalau nama Gugus itu masih ada di daftar terbaru. */
      refreshRegisterGugusOptions_();
    }
  }catch(e){ /* abaikan error re-render, data tetap tersimpan */ }
}
function refreshRegisterGugusOptions_(){
  const sel = document.getElementById('r_gugus');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="" disabled ${current?'':'selected'} hidden>\u2014 Pilih Gugus \u2014</option>` + DB.gugus.map(g=>`<option ${g===current?'selected':''}>${escapeHtml(g)}</option>`).join('');
  if(current && !DB.gugus.includes(current)) sel.value = '';
}

/* ---------- Screen Router (public screens) ---------- */
function showScreen(id){
  ['landingScreen','registerScreen','regSuccessScreen','pesertaCheckScreen','loginScreen'].forEach(s=>{
    document.getElementById(s).classList.toggle('hidden', s!==id);
  });
  /* Pastikan panel admin (#app) selalu tersembunyi saat berpindah ke layar publik,
     supaya tidak ada 2 tampilan (mis. Bagan) yang tumpang tindih di layar. */
  document.getElementById('app').classList.add('hidden');
  if(id!=='landingScreen' && window._publicJadwalLiveTimer){ clearInterval(window._publicJadwalLiveTimer); window._publicJadwalLiveTimer=null; }
  if(id==='landingScreen') renderLanding();
  if(id==='registerScreen') prepRegisterForm();
  window.scrollTo(0,0);
}
function openRegister(){ showScreen('registerScreen'); }
function openPanduanPendaftaran(){
  const steps = [
    {icon:'fa-file-pen', color:'#2563EB', title:'1. Isi Form Pendaftaran', desc:'Klik "DAFTAR SEKARANG". Isi data koordinator/pendamping, nama sekolah, pilih Gugus, lalu centang kategori yang diikuti (boleh lebih dari satu). Untuk tiap kategori yang dicentang, isi nama, sekolah, dan foto setiap pemain sesuai jumlah yang dibutuhkan.'},
    {icon:'fa-qrcode', color:'#7C3AED', title:'2. Simpan Nomor Registrasi', desc:'Setelah berhasil kirim, Anda akan mendapat Nomor Registrasi dan QR Code. Simpan atau unduh bukti pendaftaran (PDF) \u2014 nomor ini dipakai untuk cek status dan perbaikan data nanti.'},
    {icon:'fa-magnifying-glass', color:'#0891B2', title:'3. Cek Status Pendaftaran', desc:'Kapan saja, klik "Cek Status" di beranda. Masukkan Nomor Registrasi atau Nomor HP Koordinator untuk melihat status verifikasi dan data pemain yang sudah masuk.'},
    {icon:'fa-pen', color:'#D97706', title:'4. Perbaiki Data (Jika Salah)', desc:'Di halaman Cek Status, klik badge status pendaftaran \u2192 "Perbaiki Data". Masukkan Nomor HP Koordinator untuk verifikasi, lalu Anda bisa mengedit sendiri nama pemain, sekolah, atau kategori yang salah.'},
    {icon:'fa-diagram-project', color:'#E1122F', title:'5. Lihat Bagan &amp; Jadwal', desc:'Tanpa perlu login, klik "Bagan Pertandingan" atau "Hasil &amp; Klasemen" di beranda untuk memantau jadwal, skor, dan hasil pertandingan secara langsung.'},
  ];
  openModal(`<div class="p-6">
    <div class="flex items-center justify-between mb-1">
      <h3 class="font-display font-bold text-lg"><i class="fa-regular fa-circle-question text-primary mr-1"></i> Cara Pendaftaran</h3>
      <button onclick="closeModal()" class="text-zinc-400"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <p class="text-xs text-zinc-400 mb-5">Ikuti langkah berikut supaya pendaftaran Anda lancar tanpa bingung.</p>
    <div class="space-y-4">
      ${steps.map(s=>`
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style="background:${s.color}1A;color:${s.color}"><i class="fa-solid ${s.icon}"></i></div>
          <div>
            <div class="font-display font-semibold text-sm">${s.title}</div>
            <div class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-0.5">${s.desc}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="flex gap-2 mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-700">
      <button onclick="closeModal()" class="btn-ghost flex-1 justify-center">Tutup</button>
      <button onclick="closeModal();openRegister()" class="btn-primary flex-1 justify-center"><i class="fa-solid fa-shuttlecock"></i> Daftar Sekarang</button>
    </div>
  </div>`);
}

/* ---------- Dark mode ---------- */
function toggleDark(){
  document.documentElement.classList.toggle('dark');
  SAFE_STORAGE.setItem('badmintime_dark', document.documentElement.classList.contains('dark')?'1':'0');
}
if(SAFE_STORAGE.getItem('badmintime_dark')==='1') document.documentElement.classList.add('dark');

/* ---------- Landing ---------- */
function turnamenPlainText(){ return (DB.settings && DB.settings.namaTurnamen ? DB.settings.namaTurnamen : 'BADMINTIME Tournament 2026').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim(); }
/* Memisahkan judul turnamen menjadi { name, year } \u2014 mis. "KKGO CUP 2026" -> {name:'KKGO CUP', year:'2026'} */
function turnamenNameAndYear(){
  const plain = turnamenPlainText();
  const m = plain.match(/^(.*?)\s*((?:19|20)\d{2})?$/);
  const year = (m && m[2]) ? m[2] : String(new Date().getFullYear());
  const name = (m && m[1] && m[1].trim()) ? m[1].trim() : plain;
  return { name, year };
}

function updateDynamicBranding(){
  const {name, year} = turnamenNameAndYear();
  const footer = document.getElementById('landingFooterCopyright');
  if(footer) footer.innerHTML = `&copy; ${year} ${escapeHtml(name)} Management System`;
  document.querySelectorAll('.creator-credit').forEach(el=>{ if(!el.textContent.trim()) el.textContent='Oleh : Eden Rendi, S.Pd'; });
  const logo = DB.settings.logoUrl;
  const headerLogo = document.getElementById('landingHeaderLogo');
  if(headerLogo) headerLogo.innerHTML = logo ? `<img src="${logo}" class="h-8 w-8 object-contain">` : '\u{1F3F8}';
  const heroLogoBox = document.getElementById('landingHeroLogoBox');
  const heroLogo = document.getElementById('landingHeroLogo');
  if(heroLogoBox && heroLogo){
    if(logo){ heroLogo.src = logo; heroLogoBox.classList.remove('hidden'); }
    else { heroLogoBox.classList.add('hidden'); heroLogo.removeAttribute('src'); }
  }
}

function renderLanding(){
  const {name} = turnamenNameAndYear();
  document.getElementById('landingTitle').textContent = name || 'BADMINTIME';
  document.getElementById('landingHero').innerHTML = (DB.settings.namaTurnamen || '').replace(/(\b(?:19|20)\d{2})$/,'<span class="landing-tournament-year">$1</span>');
  document.getElementById('landingSub').textContent = `${fmtDate(DB.settings.tanggalMulai)} \u2013 ${fmtDate(DB.settings.tanggalSelesai)} \u00B7 ${DB.settings.lokasi}`;
  updateDynamicBranding();
  updatePageTitle();
  const verified = DB.peserta.filter(p=>p.status==='Terverifikasi').length;
  const stats = [
    ['fa-people-group', DB.teams.length, 'Tim'],
    ['fa-user-group', DB.peserta.length, 'Peserta'],
    ['fa-shuttlecock', DB.laga.length, 'Pertandingan'],
    ['fa-trophy', DB.juaraTeamId ? (DB.teams.find(t=>t.id===DB.juaraTeamId)||{}).nama : '-', 'Juara'],
  ];
  document.getElementById('landingStats').innerHTML = stats.map(s=>`
    <div class="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-100 dark:border-zinc-800">
      <i class="fa-solid ${s[0]} text-primary mb-1"></i>
      <div class="font-display font-bold text-lg">${s[1]}</div>
      <div class="text-[11px] text-zinc-400">${s[2]}</div>
    </div>`).join('');
  /* PERBAIKAN: dulu publicPanel selalu dikosongkan tiap renderLanding() dipanggil
     -- termasuk saat dipanggil ULANG secara otomatis di latar belakang oleh
     rerenderCurrentView() (tiap tarikan data cloud, lihat CLOUD_PULL_INTERVAL_MS).
     Akibatnya kalau peserta sedang membuka "Bagan Pertandingan" atau "Hasil &
     Klasemen" untuk memantau jalannya turnamen, tampilannya tiba-tiba KOSONG tiap
     ~10-45 detik lalu harus diklik ulang -- padahal tujuan fitur ini justru supaya
     peserta bisa memantau tanpa perlu klik berulang. window._publicPanelMode
     mencatat panel mana yang sedang dibuka peserta, supaya di sini kita bisa
     merender ULANG panel yang sama (dengan data terbaru) alih-alih membiarkannya
     kosong. */
  document.getElementById('publicPanel').innerHTML = '';
  renderLandingYoutube();
  renderLandingWa();
  renderLandingPendaftaranInfo();
  if(window._publicPanelMode==='bagan') renderPublicBagan();
  else if(window._publicPanelMode==='hasil') renderPublicHasil();
}
function renderLandingYoutube(){
  const sec = document.getElementById('landingYoutubeSection');
  const grid = document.getElementById('landingYoutubeGrid');
  const videos = (DB.settings.youtubeVideos||[]).filter(v=>extractYoutubeId(v.url));
  if(!videos.length){ sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  grid.innerHTML = videos.map((v,i)=>{
    const id = extractYoutubeId(v.url);
    return `<div class="bg-white dark:bg-zinc-900 rounded-xl2 overflow-hidden shadow-softer border border-zinc-100 dark:border-zinc-800">
      <div id="ytPlayer_${i}" class="relative aspect-video cursor-pointer group" onclick="openYoutubeVideo(${i},'${id}')">
        <img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" class="w-full h-full object-cover">
        <div class="absolute inset-0 bg-black/25 group-hover:bg-black/40 transition flex items-center justify-center">
          <div class="w-14 h-14 rounded-full bg-red-600 text-white flex items-center justify-center text-xl shadow-lg"><i class="fa-solid fa-play ml-1"></i></div>
        </div>
      </div>
      ${v.title?`<div class="p-3 text-xs font-semibold truncate">${escapeHtml(v.title)}</div>`:''}
    </div>`;
  }).join('');
}
function renderLandingWa(){
  const sec = document.getElementById('landingWaSection');
  if(!DB.settings.waNumber){ sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  document.getElementById('landingWaBtn').href = buildWaLink();
}
/* ---------- Informasi & Countdown Pendaftaran ---------- */
function fmtDateFull(iso){
  if(!iso) return '-';
  const d = new Date(iso.length<=10 ? iso+'T00:00:00' : iso);
  if(isNaN(d)) return '-';
  const HARI=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const BLN=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${HARI[d.getDay()]}, ${d.getDate()} ${BLN[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateTimeFull(iso){
  if(!iso) return '-';
  const d = new Date(iso.length<=10 ? iso+'T00:00:00' : iso);
  if(isNaN(d)) return '-';
  const jam = String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return `${fmtDateFull(iso)} \u00B7 ${jam} WIB`;
}
function countdownBoxHTML(prefix){
  const units=[['D','Hari'],['H','Jam'],['M','Menit'],['S','Detik']];
  return units.map(([k,label])=>`<div class="bg-zinc-50 dark:bg-zinc-800 rounded-xl px-2 py-3 text-center">
    <div class="font-display font-extrabold text-xl md:text-2xl text-primary" id="${prefix}_${k}">00</div>
    <div class="text-[10px] text-zinc-400 uppercase tracking-wide mt-0.5">${label}</div>
  </div>`).join('');
}
let _countdownTimer = null;
function renderLandingPendaftaranInfo(){
  const s = DB.settings;
  const sec = document.getElementById('landingPendaftaranSection');
  if(!sec) return;
  const anySet = s.pendaftaranDibuka || s.pendaftaranDitutup || s.batasBayarTanggal || s.thbUrl;
  if(_countdownTimer){ clearInterval(_countdownTimer); _countdownTimer=null; }
  if(!anySet){ sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');

  const dibukaBox = document.getElementById('landingDaftarDibuka');
  if(s.pendaftaranDibuka){ dibukaBox.classList.remove('hidden'); document.getElementById('landingDaftarDibukaText').textContent = fmtDateFull(s.pendaftaranDibuka); }
  else dibukaBox.classList.add('hidden');

  const ditutupBox = document.getElementById('landingDaftarDitutup');
  if(s.pendaftaranDitutup){ ditutupBox.classList.remove('hidden'); document.getElementById('landingDaftarDitutupText').textContent = fmtDateTimeFull(s.pendaftaranDitutup); }
  else ditutupBox.classList.add('hidden');

  const cdBox = document.getElementById('landingCountdownDaftarBox');
  if(s.pendaftaranDitutup){ cdBox.classList.remove('hidden'); document.getElementById('landingCountdownDaftar').innerHTML = countdownBoxHTML('cdDaftar'); }
  else cdBox.classList.add('hidden');

  const byBox = document.getElementById('landingCountdownBayarBox');
  if(s.batasBayarTanggal){
    byBox.classList.remove('hidden');
    document.getElementById('landingBatasBayarText').textContent = fmtDateTimeFull(s.batasBayarTanggal);
    document.getElementById('landingCountdownBayar').innerHTML = countdownBoxHTML('cdBayar');
  } else byBox.classList.add('hidden');

  const thbBox = document.getElementById('landingThbBox');
  if(s.thbUrl){
    thbBox.classList.remove('hidden');
    const link = document.getElementById('landingThbLink');
    link.href = s.thbUrl;
    link.setAttribute('download', s.thbFileName || 'Technical-Handbook.pdf');
  } else thbBox.classList.add('hidden');

  updateCountdownsTick();
  _countdownTimer = setInterval(updateCountdownsTick, 1000);
}
function updateCountdownsTick(){
  const s = DB.settings;
  tickOne(s.pendaftaranDitutup, 'cdDaftar', 'landingCountdownDaftarBox', 'landingCountdownDaftar', 'Pendaftaran telah ditutup');
  tickOne(s.batasBayarTanggal, 'cdBayar', 'landingCountdownBayarBox', 'landingCountdownBayar', 'Batas waktu pembayaran telah lewat');
}
function tickOne(targetIso, prefix, boxId, gridId, closedMsg){
  const box = document.getElementById(boxId);
  if(!box || box.classList.contains('hidden') || !targetIso) return;
  const diff = new Date(targetIso) - new Date();
  const grid = document.getElementById(gridId);
  if(diff<=0){
    if(grid && !grid.dataset.closed){ grid.innerHTML = `<div class="cd-closed text-center text-sm font-bold text-red-500 py-2"><i class="fa-solid fa-circle-xmark mr-1"></i>${closedMsg}</div>`; grid.dataset.closed='1'; }
    return;
  }
  const sec = Math.floor(diff/1000);
  const d = Math.floor(sec/86400), h = Math.floor((sec%86400)/3600), m = Math.floor((sec%3600)/60), ss = sec%60;
  const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.textContent = String(val).padStart(2,'0'); };
  set(prefix+'_D', d); set(prefix+'_H', h); set(prefix+'_M', m); set(prefix+'_S', ss);
}
function renderPublicBagan(){
  window._publicPanelMode = 'bagan';
  /* Bagan (bracket) & Jadwal Pertandingan ditampilkan berdampingan supaya
     peserta bisa langsung memantau jalannya turnamen: lihat posisi tim di
     bagan SEKALIGUS jam mainnya & kategori yang sedang dimainkan, tanpa
     harus berpindah halaman. Di layar sempit (HP), jadwal otomatis pindah
     ke bawah bagan (grid-cols-1).
     Tombol "Download" di kedua panel memanggil LANGSUNG fungsi cetak yang
     sama persis dipakai admin (printBagan/printJadwal) -- supaya file yang
     diunduh peserta 100% identik dengan yang diunduh admin (1 lembar,
     hitam-putih standar, tanpa kolom Aksi). Tampilan on-screen (yang ini,
     view) sengaja dibuat lebih kaya -- berwarna per Partai + penanda LIVE --
     tapi itu TIDAK ikut ke hasil unduhan. */
  document.getElementById('publicPanel').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
    <div id="publicPanelBagan" class="public-panel-card lg:col-span-3 bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800" style="--panel-accent:#E1122F">
      <div class="public-panel-head flex items-center justify-between mb-3 no-print" onclick="togglePublicPanel('publicPanelBagan')">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="public-panel-head-icon"><i class="fa-solid fa-diagram-project"></i></div>
          <div class="font-display font-semibold text-sm truncate">Bagan Pertandingan</div>
        </div>
        <div class="public-panel-btn-group">
          <button onclick="event.stopPropagation();downloadPublicBagan()" class="btn-ghost text-xs"><i class="fa-solid fa-download"></i> Download</button>
          <i class="fa-solid fa-chevron-down public-panel-collapse-icon text-zinc-400 text-xs ml-1"></i>
        </div>
      </div>
      <div class="public-panel-body">
        <div id="publicBaganBox"></div>
      </div>
    </div>
    <div id="publicPanelJadwal" class="public-panel-card lg:col-span-2 bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800" style="--panel-accent:#2563EB">
      <div class="public-panel-head flex items-center justify-between mb-1 no-print" onclick="togglePublicPanel('publicPanelJadwal')">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="public-panel-head-icon" style="--panel-accent:#2563EB"><i class="fa-solid fa-calendar-days"></i></div>
          <div class="font-display font-semibold text-sm flex items-center gap-1.5 truncate">Jadwal Pertandingan
            <span id="publicJadwalLiveDot" class="hidden items-center gap-1 text-[10px] font-bold text-red-500 ml-1"><span class="jdw-live-dot"></span> LIVE</span>
          </div>
        </div>
        <div class="public-panel-btn-group">
          <button onclick="event.stopPropagation();downloadPublicJadwal()" class="btn-ghost text-xs"><i class="fa-solid fa-download"></i> Download</button>
          <i class="fa-solid fa-chevron-down public-panel-collapse-icon text-zinc-400 text-xs ml-1"></i>
        </div>
      </div>
      <div class="public-panel-body">
        <div class="text-[11px] text-zinc-400 mb-3 mt-2 no-print">Kategori yang sedang berlangsung ditandai LIVE merah, yang sudah selesai tampil hijau.</div>
        <div id="publicJadwalRingkas" class="max-h-[560px] overflow-auto pr-1 -mx-1 px-1"></div>
      </div>
    </div>
  </div>`;
  drawBagan('publicBaganBox', false);
  renderPublicJadwalRingkas_();
  if(window._publicJadwalLiveTimer) clearInterval(window._publicJadwalLiveTimer);
  /* Disegarkan tiap 20 detik supaya highlight "sedang bertanding" otomatis
     berpindah begitu jamnya lewat, tanpa peserta perlu refresh halaman. */
  window._publicJadwalLiveTimer = setInterval(renderPublicJadwalRingkas_, 20000);
}
/* Buka/tutup (dropdown) panel Bagan / Jadwal Pertandingan di halaman awal --
   supaya peserta bisa menyembunyikan panel yang sedang tidak diperlukan
   tanpa harus meninggalkan halaman ini. Klik di area judul (bukan tombol
   Lihat/Download) untuk toggle; ikon chevron ikut berputar mengikuti state. */
function togglePublicPanel(panelId){
  const el = document.getElementById(panelId);
  if(el) el.classList.toggle('is-collapsed');
}
/* Pratinjau Bagan Pertandingan SEBELUM diunduh -- memakai generator HTML yang
   sama persis (rbHeaderHTML/rbBracketBodyHTML) dengan yang dipakai untuk
   cetak PDF, jadi apa yang dilihat peserta di pratinjau ini 100% sama dengan
   isi file yang akan diunduh. Tombol "Unduh PDF" di dalam modal langsung
   melanjutkan ke alur cetak (printBagan) yang sudah ada. */
function previewBagan(){
  if(!DB.baganMeta.generated || !DB.laga.length){
    Swal.fire({icon:'info', title:'Bagan belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu.', confirmButtonColor:'#2563EB'});
    return;
  }
  Swal.fire({
    title:'Pratinjau Bagan Pertandingan',
    html:`<div style="max-height:65vh;overflow:auto;border:1px solid #E4E4E7;border-radius:10px;padding:14px;background:#fff;text-align:left" class="bagan-redesign">${rbHeaderHTML()}${rbBracketBodyHTML(false)}</div>`,
    width:720,
    confirmButtonText:'Unduh PDF',
    confirmButtonColor:'#2563EB',
    showCancelButton:true,
    cancelButtonText:'Tutup'
  }).then(r=>{ if(r.isConfirmed) printBagan(); });
}
/* Pratinjau Jadwal Pertandingan SEBELUM diunduh -- memakai tabel yang PERSIS
   sama dengan hasil cetak/unduhan (forPrint=true, hitam-putih, tanpa kolom
   Aksi) supaya yang dilihat peserta di pratinjau ini 100% sama dengan file
   yang akan diunduh (tampilan RINGKAS di layar utama sengaja dibuat
   berbeda/lebih sederhana -- lihat renderPublicJadwalRingkas_ -- supaya
   tidak terpotong di HP; hanya versi UNDUH yang mengikuti format admin). */
function previewJadwal(){
  if(!DB.laga.length){
    Swal.fire({icon:'info', title:'Jadwal belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu di menu Bagan sebelum melihat jadwal.', confirmButtonColor:'#2563EB'});
    return;
  }
  Swal.fire({
    title:'Pratinjau Jadwal Pertandingan',
    html:`<div style="max-height:65vh;overflow:auto;border:1px solid #E4E4E7;border-radius:10px;padding:6px;background:#fff;text-align:left"><table class="w-full border-collapse" style="table-layout:fixed;font-size:9px">${buildJadwalTableHTML(true)}</table></div>`,
    width:760,
    confirmButtonText:'Unduh PDF',
    confirmButtonColor:'#2563EB',
    showCancelButton:true,
    cancelButtonText:'Tutup'
  }).then(r=>{ if(r.isConfirmed) printJadwal(); });
}
/* ---------- Jadwal (publik, di sebelah Bagan) ----------
   Menentukan apakah sebuah PARTAI sedang berlangsung SEKARANG, berdasarkan:
   1) status 'Sedang Main' yang diset otomatis begitu admin mulai mengisi
      skor (lihat simpanSkor ~ l.status='Sedang Main'), ATAU
   2) jam yang dijadwalkan admin (tanggal = hari ini & waktu sekarang berada
      di antara jam mulai Main pertama s/d jam selesai Main terakhir Partai
      itu) -- supaya peserta tetap bisa memantau "partai mana yang sedang
      jalan" dari jadwal, sekalipun admin belum sempat klik input skor.
   Dipakai untuk titik "LIVE" ringkasan di judul panel & highlight kartu. */
function isPartaiLiveNow_(l){
  if(l.status==='Sedang Main') return true;
  if(l.status==='Selesai') return false;
  if(!l.tanggal || l.tanggal!==todayISO() || !l.jam) return false;
  const items = (l.partai&&l.partai.length) ? l.partai : [null];
  const n = items.length;
  const spacing = Math.max(1, parseInt(l.durasiKategori,10)||15);
  const durasiMain = Math.max(1, parseInt(l.durasiMenit,10) || spacing);
  const selesai = addMinutesToTime(l.jam, (n-1)*spacing + durasiMain);
  const now = nowTime();
  return now>=l.jam && now<=selesai;
}
/* Apakah 1 MAIN (kategori) tertentu sudah pernah diisi skornya? Dipakai untuk
   menandai kategori "Selesai" (hijau) di kartu ringkas publik. Meniru logika
   "played" yang sama dengan mainSkorText, tanpa ikut membangun HTML skornya. */
function mainSudahMain_(l, p){
  if(!p) return false;
  if((l.scoreMode||'SET_ALL')==='SCORE_42'){
    const a=(p.score42&&p.score42[0])||0, b=(p.score42&&p.score42[1])||0;
    return a>0 || b>0;
  }
  return (p.sets||[]).some(s=> s[0]>0 || s[1]>0);
}
/* ---------- Jadwal Pertandingan RINGKAS (tampilan publik di layar HP/desktop) ----------
   SENGAJA dibuat berbeda & jauh lebih sederhana dari tabel Jadwal admin
   (buildJadwalTableHTML): tabel admin punya banyak kolom sempit (Ronde,
   Tanggal, Jam, Main Ke, Pertandingan, Kategori, Skor, Aksi) yang di layar
   HP jadi terlalu lebar dan banyak terpotong/harus digeser-geser.
   Di sini ditampilkan sebagai KARTU per Partai -- ringkas, tetap
   menampilkan KATEGORI apa saja yang dipertandingkan (bukan cuma nama Team
   seperti versi paling awal dulu) beserta status tiap kategori (belum
   main / sedang LIVE / sudah selesai + skor ringkas), tapi tanpa detail
   nama pemain & rincian jam per-Main seperti tabel admin. Format
   admin/lengkap TETAP dipakai untuk hasil UNDUH (lihat previewJadwal &
   printJadwal, keduanya memanggil buildJadwalTableHTML apa adanya) supaya
   file yang diunduh peserta selalu identik dengan yang diunduh admin. */
function renderPublicJadwalRingkas_(){
  const box = document.getElementById('publicJadwalRingkas');
  if(!box){
    /* Panel sudah ditutup/diganti (mis. peserta pindah ke "Hasil & Klasemen") --
       hentikan timer supaya tidak terus jalan sia-sia di latar belakang. */
    if(window._publicJadwalLiveTimer){ clearInterval(window._publicJadwalLiveTimer); window._publicJadwalLiveTimer=null; }
    return;
  }
  const rows = DB.laga.slice().sort((a,b)=> jadwalSortKey(a) - jadwalSortKey(b));
  if(!rows.length){
    box.innerHTML = emptyState('fa-calendar-days','Belum ada jadwal','Generate bagan terlebih dahulu di menu Bagan untuk membuat jadwal otomatis.');
  } else {
    let lastDate;
    const cards = [];
    rows.forEach(l=>{
      if(l.tanggal !== lastDate){
        lastDate = l.tanggal;
        cards.push(`<div class="pjc-date-sep"><i class="fa-solid fa-calendar-day"></i> ${l.tanggal?fmtDateFull(l.tanggal):'Tanggal Belum Diatur'}</div>`);
      }
      const pk = partaiKe(l);
      const items = (l.partai&&l.partai.length) ? l.partai : [null];
      const spacing = Math.max(1, parseInt(l.durasiKategori,10)||15);
      const durasiMain = Math.max(1, parseInt(l.durasiMenit,10) || spacing);
      const live = isPartaiLiveNow_(l);
      const selesai = l.status === 'Selesai';
      const colorA = teamColor(l.teamA), colorB = teamColor(l.teamB);
      const katChips = items.map((p,idx)=>{
        if(!p) return '';
        const mulai = l.jam ? addMinutesToTime(l.jam, idx*spacing) : null;
        const isLiveMain = live && mulai && l.tanggal===todayISO() && l.status!=='Selesai' && nowTime()>=mulai && nowTime()<=addMinutesToTime(mulai,durasiMain);
        const done = mainSudahMain_(l,p);
        const stateCls = isLiveMain ? 'pjc-kat-live' : done ? 'pjc-kat-done' : 'pjc-kat-pending';
        const scoreHtml = done ? mainSkorText(l,p) : (isLiveMain ? '<i class="fa-solid fa-shuttlecock"></i>' : (mulai||'-'));
        // Nama pemain: kalau Main ini sudah selesai (ada pemenang), nama yang tampil sudah
        // TERKUNCI (snapshot saat itu, lihat lockPemainMain_) supaya tidak berubah walau
        // roster kategori diedit admin belakangan. Selama belum selesai, tetap mengikuti
        // data pemain PALING BARU (live) -- termasuk kalau pemain yang sama juga terdaftar
        // di kategori lain (mis. Tunggal Putra sekaligus Ganda Campuran).
        const namaA = pemainMainNama(l, p, 'A');
        const namaB = pemainMainNama(l, p, 'B');
        const playersHtml = (namaA || namaB) ? `<div class="pjc-kat-players">
            ${namaA?`<div class="pjc-kat-player"><span class="pjc-kat-player-dot" style="background:${colorA}"></span>${escapeHtml(namaA)}</div>`:''}
            ${namaB?`<div class="pjc-kat-player"><span class="pjc-kat-player-dot" style="background:${colorB}"></span>${escapeHtml(namaB)}</div>`:''}
          </div>` : '';
        // Skor rinci per-set (bukan cuma jumlah set menang) supaya "skor pemain" yang
        // tampil di halaman awal lebih informatif -- mis. "21-15 &middot; 18-21 &middot; 21-19".
        const detailScore = done ? mainSkorDetailText_(l,p) : '';
        const detailHtml = detailScore ? `<div class="pjc-kat-detail">${detailScore}</div>` : '';
        return `<div class="pjc-kat-chip ${stateCls}">
          <div class="pjc-kat-top"><span class="pjc-kat-name">${escapeHtml(kategoriNama(p.kategoriId))}</span><span class="pjc-kat-score">${scoreHtml}</span></div>
          ${playersHtml}
          ${detailHtml}
        </div>`;
      }).join('');
      // Hasil skor TIM (total kategori yang dimenangkan tiap tim) -- ditampilkan begitu
      // Partai ini berstatus Selesai, supaya peserta langsung tahu skor akhir & pemenangnya
      // tanpa harus buka menu "Hasil & Klasemen" terpisah.
      const hasilTeamHtml = selesai ? `<div class="pjc-final-result">
          <i class="fa-solid fa-trophy"></i>
          <span class="pjc-final-result-text">${l.pemenangTeam ? `${escapeHtml(teamNama(l.pemenangTeam))} Menang` : 'Seri'}</span>
          <span class="pjc-final-result-score">${l.skorTeamA}&nbsp;&#8211;&nbsp;${l.skorTeamB}</span>
        </div>` : '';
      cards.push(`<div class="pjc-card${live?' pjc-live':''}${selesai?' pjc-done':''}">
        <div class="pjc-top">
          <span class="pjc-partai-badge">${l.ronde}${pk?` &middot; Partai ${pk}`:''}</span>
          ${live?'<span class="pjc-live-badge"><span class="jdw-live-dot"></span> LIVE</span>':(selesai?'<span class="pjc-selesai-badge"><i class="fa-solid fa-circle-check"></i> Selesai</span>':(l.jam?`<span class="pjc-jam"><i class="fa-regular fa-clock"></i> ${l.jam}</span>`:''))}
        </div>
        <div class="pjc-teams">
          <div class="pjc-team"><span class="pjc-dot" style="background:${colorA}"></span><span class="pjc-team-name">${escapeHtml(teamNama(l.teamA))}</span></div>
          <div class="pjc-vs">VS</div>
          <div class="pjc-team pjc-team-b"><span class="pjc-team-name">${escapeHtml(teamNama(l.teamB))}</span><span class="pjc-dot" style="background:${colorB}"></span></div>
        </div>
        ${hasilTeamHtml}
        <div class="pjc-kategori-list">${katChips}</div>
      </div>`);
    });
    box.innerHTML = `<div class="pjc-list">${cards.join('')}</div>`;
  }
  const anyLive = DB.laga.some(isPartaiLiveNow_);
  const dot = document.getElementById('publicJadwalLiveDot');
  if(dot) dot.classList.toggle('hidden', !anyLive);
}
function renderPublicHasil(){
  window._publicPanelMode = 'hasil';
  if(window._publicJadwalLiveTimer){ clearInterval(window._publicJadwalLiveTimer); window._publicJadwalLiveTimer=null; }
  const rows = DB.laga.filter(l=>l.status==='Selesai');
  document.getElementById('publicPanel').innerHTML = `<div class="bg-white dark:bg-zinc-900 rounded-xl2 shadow-softer border border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-50 dark:divide-zinc-800">
    ${rows.map(l=>`<div class="p-4 flex items-center justify-between text-sm">
      <div><span class="badge bg-zinc-100 dark:bg-zinc-800">${l.ronde}</span> <b>${teamNama(l.teamA)}</b> vs <b>${teamNama(l.teamB)}</b></div>
      <div class="font-display font-bold text-primary">${(l.skorTeamA===undefined||l.skorTeamA===null)?0:l.skorTeamA} - ${(l.skorTeamB===undefined||l.skorTeamB===null)?0:l.skorTeamB}</div>
    </div>`).join('') || `<div class="p-8 text-center text-zinc-400 text-sm">Belum ada hasil pertandingan.</div>`}
  </div>`;
}

/* ---------- Registration ---------- */
function prepRegisterForm(){
  document.getElementById('regForm').reset();
  document.getElementById('r_gugus').innerHTML = `<option value="" disabled selected hidden>\u2014 Pilih Gugus \u2014</option>` + DB.gugus.map(g=>`<option>${escapeHtml(g)}</option>`).join('');
  window._regPemain = {};
  window._regFilled = {};
  renderKategoriBox();
  const box = document.getElementById('r_pemainBox'); if(box) box.innerHTML = '';
  resetGugusWarning_();
}
/* ---------- Cegah pendaftaran ganda per Gugus ----------
   Satu Gugus hanya boleh didaftarkan SATU KALI (oleh satu koordinator).
   Kalau Gugus yang dipilih sudah punya data peserta tersimpan (dan belum
   ditolak admin), form pendaftaran diblokir dan pengguna diarahkan untuk
   menghubungi admin atau memakai menu "Cek Status Pendaftaran" (perbaikan
   data lewat verifikasi Nomor HP Koordinator) supaya tidak tercipta data
   ganda/tumpang tindih untuk Gugus yang sama. */
function gugusSudahTerdaftar_(gugus){
  if(!gugus) return false;
  return DB.peserta.some(p=> (p.gugus||'').trim().toLowerCase()===gugus.trim().toLowerCase() && p.status!=='Ditolak');
}
function resetGugusWarning_(){
  const warn = document.getElementById('r_gugusWarning'); if(warn) warn.classList.add('hidden');
  const submitBtn = document.querySelector('#regForm button[type="submit"]');
  if(submitBtn){ submitBtn.disabled = false; submitBtn.classList.remove('opacity-40','cursor-not-allowed'); }
}
function checkGugusDuplikat(){
  const gugus = document.getElementById('r_gugus').value;
  const warn = document.getElementById('r_gugusWarning');
  const submitBtn = document.querySelector('#regForm button[type="submit"]');
  const waLink = document.getElementById('r_gugusWarningWa');
  if(!warn) return false;
  if(gugusSudahTerdaftar_(gugus)){
    warn.classList.remove('hidden');
    if(submitBtn){ submitBtn.disabled = true; submitBtn.classList.add('opacity-40','cursor-not-allowed'); }
    if(waLink){
      const num = (DB.settings && DB.settings.waNumber) ? waIntlNumber(DB.settings.waNumber) : '';
      if(num){ waLink.href = `https://wa.me/${num}?text=${encodeURIComponent('Halo Admin, saya ingin bertanya soal pendaftaran Gugus '+gugus+' yang sepertinya sudah terdaftar.')}`; waLink.classList.remove('hidden'); }
      else waLink.classList.add('hidden');
    }
    return true;
  }
  resetGugusWarning_();
  return false;
}
/* Kotak daftar kategori \u2014 checkbox pilih kategori + tombol "Isi Data Pemain" per kategori.
   Setiap kategori diisi SATU PERSATU lewat modal, dengan tanda \u2713 setelah tersimpan. */
function renderKategoriBox(){
  document.getElementById('r_kategoriBox').innerHTML = KATEGORI.filter(k=>DB.settings.kategoriAktif.includes(k.id)).map(k=>{
    const c=KATEGORI_COLORS[k.id]||{bg:'#F8FAFC',border:'#64748B',text:'#334155',dark:'#1E293B'};
    const checked = !!window._regPemain[k.id];
    const filled = !!window._regFilled[k.id];
    return `<div class="registration-category rounded-xl px-3 py-3" style="background:${c.bg};border:2px solid ${filled?'#16A34A':c.border};color:${c.text}">
      <label class="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" value="${k.id}" class="r_kat rounded" ${checked?'checked':''} onchange="toggleKategoriPemain(this)">
        <span class="team-color-chip" style="background:${c.border}"></span><b>${k.nama}</b>
        <span class="ml-auto text-[10px] opacity-70">${k.jumlahPemain} pemain</span>
      </label>
      ${checked?`<button type="button" onclick="openKategoriPemainModal('${k.id}')" class="mt-2 w-full text-[11px] font-semibold rounded-lg py-2 flex items-center justify-center gap-1.5 transition" style="background:${filled?'#16A34A':c.border};color:#fff">
        <i class="fa-solid ${filled?'fa-circle-check':'fa-pen-to-square'}"></i> ${filled?'Sudah Diisi \u2014 Klik untuk Ubah':'Isi Data Pemain'}
      </button>`:''}
    </div>`;
  }).join('');
}
/* Saat kategori dicentang \u2192 siapkan slot data pemain kosong lalu langsung buka modal isian.
   Saat dibatalkan centangnya \u2192 hapus data pemain kategori tsb. */
function toggleKategoriPemain(cb){
  const k = KATEGORI.find(x=>x.id===cb.value);
  if(!k) return;
  if(cb.checked){
    if(!window._regPemain[k.id]) window._regPemain[k.id] = Array.from({length:k.jumlahPemain}, ()=>({nama:'', asalSekolah:'', foto:''}));
    delete window._regFilled[k.id];
    renderKategoriBox();
    openKategoriPemainModal(k.id);
  } else {
    delete window._regPemain[k.id];
    delete window._regFilled[k.id];
    renderKategoriBox();
  }
}
/* Modal isian data pemain untuk SATU kategori saja */
function openKategoriPemainModal(kid){
  const k = KATEGORI.find(x=>x.id===kid); if(!k) return;
  if(!window._regPemain[kid]) window._regPemain[kid] = Array.from({length:k.jumlahPemain}, ()=>({nama:'', asalSekolah:'', foto:''}));
  const c = KATEGORI_COLORS[kid]||{bg:'#F8FAFC',border:'#64748B',text:'#334155'};
  openModal(`<div class="p-5 md:p-6">
    <div class="flex items-center gap-2 mb-1">
      <span class="team-color-chip" style="background:${c.border}"></span>
      <h3 class="font-display font-bold text-lg" style="color:${c.text}">${k.nama}</h3>
      <span class="badge ml-auto" style="background:${c.border};color:#fff">${k.jumlahPemain} pemain</span>
    </div>
    <p class="text-[11px] text-zinc-400 mb-4">Lengkapi data pemain kategori ini, lalu klik Simpan Kategori.</p>
    <div id="regKatModalFields" class="space-y-4">${renderKatFieldsHTML(kid)}</div>
    <div class="flex gap-2 mt-5">
      <button type="button" onclick="closeModal()" class="btn-ghost flex-1 justify-center">Batal</button>
      <button type="button" onclick="saveKategoriPemain('${kid}')" class="btn-primary flex-1 justify-center"><i class="fa-solid fa-check"></i> Simpan Kategori</button>
    </div>
  </div>`);
}
function renderKatFieldsHTML(kid){
  const k = KATEGORI.find(x=>x.id===kid); if(!k) return '';
  const list = window._regPemain[kid]||[];
  return list.map((pl,i)=>`
    <div class="${i>0?'pt-4 border-t border-dashed border-zinc-200 dark:border-zinc-700':''} space-y-3">
      ${list.length>1?`<div class="text-xs font-semibold text-zinc-500 dark:text-zinc-300">Peserta ${i+1}</div>`:''}
      <div><label class="lbl">Nama Lengkap</label><input class="inp" data-kat="${kid}" data-idx="${i}" data-field="nama" value="${escapeHtml(pl.nama)}" oninput="updatePemainField(this)" required></div>
      <div><label class="lbl">Asal Sekolah</label><input class="inp" data-kat="${kid}" data-idx="${i}" data-field="asalSekolah" value="${escapeHtml(pl.asalSekolah)}" oninput="updatePemainField(this)" required></div>
      <div>
        <label class="lbl">Upload Foto Peserta</label>
        <input type="file" accept="image/*" class="hidden" id="foto_${kid}_${i}" onchange="previewPemainFoto(this,'${kid}',${i})">
        <div onclick="document.getElementById('foto_${kid}_${i}').click()" class="border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-center text-xs text-zinc-400 cursor-pointer flex items-center gap-3 justify-center">
          <img id="fotoPreview_${kid}_${i}" class="${pl.foto?'':'hidden'} w-10 h-10 rounded-full object-cover" src="${pl.foto||''}">
          <span id="fotoLabel_${kid}_${i}"><i class="fa-solid fa-camera mb-1 block text-lg"></i> ${pl.foto?'Ganti foto':'Klik untuk unggah foto'}</span>
        </div>
      </div>
    </div>`).join('');
}
function updatePemainField(el){
  const {kat, idx, field} = el.dataset;
  if(window._regPemain[kat] && window._regPemain[kat][idx]) window._regPemain[kat][idx][field] = el.value;
}
function previewPemainFoto(input, kid, idx){
  const file = input.files[0]; if(!file) return;
  resizeImageFile(file, 500, 0.85, 'image/jpeg').then(url=>{
    if(window._regPemain[kid] && window._regPemain[kid][idx]) window._regPemain[kid][idx].foto = url;
    const img = document.getElementById(`fotoPreview_${kid}_${idx}`); if(img){ img.src=url; img.classList.remove('hidden'); }
    const lbl = document.getElementById(`fotoLabel_${kid}_${idx}`); if(lbl) lbl.textContent = file.name;
  });
}
/* Validasi & simpan data satu kategori, tandai \u2713 selesai, tutup modal */
function saveKategoriPemain(kid){
  const k = KATEGORI.find(x=>x.id===kid); if(!k) return;
  const list = window._regPemain[kid]||[];
  for(const pl of list){
    if(!pl.nama.trim() || !pl.asalSekolah.trim()){
      Swal.fire({icon:'warning', title:'Data belum lengkap', text:`Lengkapi Nama Lengkap dan Asal Sekolah untuk semua peserta pada kategori ${k.nama}.`, confirmButtonColor:'#2563EB'});
      return;
    }
  }
  window._regFilled[kid] = true;
  closeModal();
  renderKategoriBox();
  Swal.fire({toast:true, position:'top-end', icon:'success', title:`${k.nama} tersimpan`, showConfirmButton:false, timer:1700});
}
function submitRegister(e){
  e.preventDefault();
  const namaKoordinator = document.getElementById('r_nama').value.trim();
  const sekolahTim = document.getElementById('r_sekolah').value.trim();
  const hpKoordinator = document.getElementById('r_hp').value.trim();
  const gugus = document.getElementById('r_gugus').value;
  if(gugusSudahTerdaftar_(gugus)){
    Swal.fire({icon:'error', title:'Gugus Sudah Terdaftar', text:'Gugus ini sudah didaftarkan. Silahkan hubungi admin.', confirmButtonColor:'#E1122F'});
    checkGugusDuplikat();
    return false;
  }
  const kategoriTerisi = KATEGORI.filter(k=>window._regPemain[k.id]);
  if(!kategoriTerisi.length){ Swal.fire({icon:'warning', title:'Pilih minimal satu kategori', text:'Centang kategori yang diikuti, lalu isi datanya terlebih dahulu.', confirmButtonColor:'#2563EB'}); return false; }
  const belumDiisi = kategoriTerisi.filter(k=>!window._regFilled[k.id]);
  if(belumDiisi.length){
    Swal.fire({icon:'warning', title:'Ada kategori belum diisi', text:`Klik kategori berikut untuk melengkapi data pemain terlebih dahulu: ${belumDiisi.map(k=>k.nama).join(', ')}.`, confirmButtonColor:'#2563EB'});
    return false;
  }
  for(const k of kategoriTerisi){
    for(const pl of window._regPemain[k.id]){
      if(!pl.nama.trim() || !pl.asalSekolah.trim()){
        Swal.fire({icon:'warning', title:'Data pemain belum lengkap', text:`Lengkapi Nama Lengkap dan Asal Sekolah pada kategori ${k.nama}.`, confirmButtonColor:'#2563EB'});
        return false;
      }
    }
  }
  const seq = DB.peserta.length+1;
  const nomorRegistrasi = `REG-${new Date().getFullYear()}-${String(seq).padStart(4,'0')}`;
  const kelompokId = uid('grp');
  const waktuDaftar = new Date().toISOString();
  // Team tidak lagi ditentukan otomatis di sini. Keterkaitan Team \u2194 Gugus
  // sepenuhnya mengikuti pilihan admin di halaman Team (assignGugusToTeam),
  // supaya tidak ada 2 sumber data yang saling bentrok.
  const pesertaBaru = [];
  kategoriTerisi.forEach(k=>{
    window._regPemain[k.id].forEach((pl,i)=>{
      pesertaBaru.push({
        id: uid('psr'), kelompokId, nomorRegistrasi,
        koordinator: namaKoordinator, hpKoordinator,
        nama: pl.nama.trim(), asalSekolah: pl.asalSekolah.trim() || sekolahTim,
        gugus, kategori:[k.id], kategoriId:k.id, slot:i+1,
        foto: pl.foto || '', status:'Menunggu Verifikasi',
        teamId: null, waktuDaftar
      });
    });
  });
  pesertaBaru.forEach(p=>{ DB.peserta.push(p); });
  // Jika admin sudah pernah menetapkan Team untuk gugus ini, pemain baru
  // otomatis ikut masuk ke Team tersebut tanpa perlu aksi tambahan.
  resyncPesertaTeamLinks();
  const linkedTeam = DB.teams.find(t=>t.gugus===gugus);
  if(linkedTeam){ syncTeamMeta(linkedTeam); }
  saveDB();
  addLog('Pendaftaran', `${namaKoordinator} (Gugus ${gugus}) mendaftarkan ${pesertaBaru.length} pemain dengan nomor ${nomorRegistrasi}`);
  // Kirim pendaftaran LANGSUNG ke server (di luar mekanisme "simpan seluruh
  // database" yang tertunda ~1.5 detik) supaya pendaftaran ini pasti sampai
  // ke server -- termasuk saat admin sedang offline, dan tidak tertimpa
  // kalau ada peserta lain yang mendaftar hampir bersamaan.
  if(cloudSyncEnabled()){
    window._cloudStatus.state='syncing'; updateCloudStatusUI();
    registerPesertaToCloud_(pesertaBaru, linkedTeam, nomorRegistrasi).then(r=>{
      if(r.ok){
        window._cloudStatus = {state:'success', lastSyncAt:new Date().toISOString(), lastError:null};
        showCloudSaveToast_(true);
      }else if(r.duplicateGugus){
        // Kasus langka: dua koordinator mendaftarkan Gugus yang sama nyaris
        // bersamaan, keduanya lolos pengecekan di browser, tapi server (yang
        // menerima permintaan lebih dulu, di dalam lock) sudah menyimpan
        // salah satunya. Batalkan salinan lokal yang baru saja ditambahkan
        // supaya data tidak "sukses" di HP ini padahal tidak tersimpan di
        // server, lalu beri tahu penggunanya dengan jelas.
        const idsBaru = pesertaBaru.map(p=>p.id);
        DB.peserta = DB.peserta.filter(p=>!idsBaru.includes(p.id));
        saveDB();
        window._cloudStatus = {state:'error', lastSyncAt:window._cloudStatus.lastSyncAt, lastError:r.reason};
        updateCloudStatusUI();
        showScreen('registerScreen');
        prepRegisterForm();
        Swal.fire({icon:'error', title:'Gugus Sudah Terdaftar', text:'Gugus ini baru saja didaftarkan oleh orang lain. Silahkan hubungi admin.', confirmButtonColor:'#E1122F'});
        return;
      }else{
        window._cloudStatus = {state:'error', lastSyncAt:window._cloudStatus.lastSyncAt, lastError:r.reason};
        showCloudSaveToast_(false, r.reason);
      }
      updateCloudStatusUI();
    });
  }
  window._lastReg = { nomorRegistrasi, koordinator:namaKoordinator, asalSekolah:sekolahTim, gugus, teamId:linkedTeam?linkedTeam.id:null, pemain:pesertaBaru };
  document.getElementById('regNumberDisplay').textContent = nomorRegistrasi;
  showScreen('regSuccessScreen');
  document.getElementById('regQrBox').innerHTML = '';
  new QRCode(document.getElementById('regQrBox'), {text: nomorRegistrasi, width:160, height:160, colorDark:'#0B1220'});
  return false;
}
function downloadBuktiPdf(){
  const r = window._lastReg; if(!r) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.text('BUKTI PENDAFTARAN', 105, 20, {align:'center'});
  doc.setFontSize(11); doc.text(turnamenPlainText(), 105, 28, {align:'center'});
  doc.setDrawColor(37,99,235); doc.line(20,34,190,34);
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  const header = [
    ['Nomor Registrasi', r.nomorRegistrasi], ['Nama Koordinator', r.koordinator],
    ['Asal Sekolah', r.asalSekolah], ['Gugus', r.gugus]
  ];
  let y=46; header.forEach(l=>{ doc.setFont('helvetica','bold'); doc.text(l[0]+':',20,y); doc.setFont('helvetica','normal'); doc.text(String(l[1]||'-'),70,y); y+=8; });
  y+=4; doc.setFont('helvetica','bold'); doc.text('Daftar Pemain:',20,y); y+=8;
  doc.setFont('helvetica','normal');
  r.pemain.forEach(p=>{
    if(y>280){ doc.addPage(); y=15; }
    const jml = r.pemain.filter(x=>x.kategoriId===p.kategoriId).length;
    doc.text(`${kategoriNama(p.kategoriId)}${jml>1?' - Peserta '+p.slot:''}: ${p.nama} (${p.asalSekolah})`, 22, y);
    y+=7;
  });
  doc.save(`bukti-daftar-${r.nomorRegistrasi}.pdf`);
}

/* ---------- Cek Status Peserta (public) ---------- */
function doPesertaCheck(){
  const raw = document.getElementById('checkQuery').value.trim();
  const q = raw.toLowerCase();
  const list = q.startsWith('reg-')
    ? DB.peserta.filter(x=> x.nomorRegistrasi.toLowerCase()===q)
    : DB.peserta.filter(x=> normalizeHp(x.hpKoordinator) && normalizeHp(x.hpKoordinator)===normalizeHp(raw));
  const box = document.getElementById('pesertaCheckResult');
  if(!raw || !list.length){ box.innerHTML = `<div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 text-center text-sm text-zinc-400 border border-zinc-100 dark:border-zinc-800">Data tidak ditemukan. Pastikan nomor HP koordinator (atau nomor registrasi) benar.</div>`; return; }
  const first = list[0];
  const teamIds = [...new Set(list.map(p=>p.teamId).filter(Boolean))];
  const laga = DB.laga.filter(l=> teamIds.includes(l.teamA) || teamIds.includes(l.teamB));
  box.innerHTML = `<div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-14 h-14 rounded-full bg-primary-light dark:bg-primary/10 flex items-center justify-center text-primary"><i class="fa-solid fa-people-group"></i></div>
      <div><div class="font-display font-bold">${escapeHtml(first.koordinator||'-')}</div><div class="text-xs text-zinc-400 font-mono">${first.nomorRegistrasi}</div></div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs text-zinc-500 mb-4">
      <div><b class="text-zinc-700 dark:text-zinc-200">Gugus:</b> ${escapeHtml(first.gugus)}</div>
      <div><b class="text-zinc-700 dark:text-zinc-200">Jumlah Pemain:</b> ${list.length}</div>
    </div>
    <button type="button" onclick="verifyHpAndEditRegistration('${first.nomorRegistrasi}')" class="w-full flex items-center gap-2 bg-amber-100 dark:bg-amber-900/20 hover:brightness-95 rounded-xl p-3 mb-4 text-left transition">
      <span class="badge bg-amber-100 text-amber-700">${first.status||'Menunggu Verifikasi'}</span>
      <span class="text-xs text-amber-700 dark:text-amber-400 flex-1">Status Pendaftaran \u2014 klik untuk <b>Perbaiki Data</b></span>
      <i class="fa-solid fa-pen text-amber-600"></i>
    </button>
    <div class="text-xs font-semibold mb-2">Daftar Pemain &amp; Status</div>
    <div class="space-y-2 mb-2">
      ${list.map(p=>{
        const team = p.teamId ? DB.teams.find(t=>t.id===p.teamId) : null;
        return `<div class="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-lg p-2">
          ${p.foto?`<img src="${p.foto}" class="w-9 h-9 rounded-full object-cover">`:`<div class="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-400"><i class="fa-solid fa-user text-xs"></i></div>`}
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold truncate">${escapeHtml(p.nama)} <span class="text-zinc-400 font-normal">\u00B7 ${kategoriNama(p.kategoriId)}</span></div>
            <div class="text-[11px] text-zinc-400">Tim: ${team?escapeHtml(team.nama):'Belum ditentukan admin'}</div>
          </div>
          <span class="badge ${p.status==='Terverifikasi'?'bg-emerald-100 text-emerald-700':p.status==='Ditolak'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}">${p.status}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="text-xs font-semibold mb-2 mt-4">Jadwal &amp; Hasil Tim</div>
    ${laga.length ? laga.map(l=>`<div class="text-xs bg-zinc-50 dark:bg-zinc-800/60 rounded-lg p-2 mb-1 flex justify-between"><span>${l.ronde} \u00B7 ${escapeHtml(teamNama(l.teamA))} vs ${escapeHtml(teamNama(l.teamB))}</span><span class="badge ${l.status==='Selesai'?'bg-emerald-100 text-emerald-700':'bg-zinc-100 text-zinc-500'}">${l.status}</span></div>`).join('') : `<div class="text-xs text-zinc-400">Belum ada jadwal.</div>`}
  </div>`;
}

/* ---------- Perbaiki Data (publik, diverifikasi Nomor HP Koordinator) ---------- */
function normalizeHp(s){ let d=(s||'').toString().replace(/\D/g,''); if(d.startsWith('62')) d='0'+d.slice(2); return d; }

/* ---------- WhatsApp & YouTube helpers ---------- */
function waIntlNumber(s){
  let d=(s||'').toString().replace(/\D/g,'');
  if(d.startsWith('0')) d='62'+d.slice(1);
  else if(!d.startsWith('62')) d='62'+d;
  return d;
}
function buildWaLink(){
  const num = waIntlNumber(DB.settings.waNumber);
  const msg = encodeURIComponent(DB.settings.waMessage || 'Halo Admin, saya ingin bertanya tentang turnamen.');
  return `https://wa.me/${num}?text=${msg}`;
}
function extractYoutubeId(url){
  if(!url) return '';
  /* PERBAIKAN: link yang di-copy dari aplikasi YouTube di HP kadang membawa
     karakter tak kasat mata (zero-width space, BOM, dsb.) yang tidak
     terlihat di kotak input tapi membuat link gagal dikenali. Karakter ini
     dibuang dulu sebelum divalidasi. */
  const str = url.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '').trim();
  if(!str) return '';
  // Tautan yang sudah berupa ID video YouTube polos (10-12 karakter khas YouTube)
  if(/^[A-Za-z0-9_-]{10,12}$/.test(str)) return str;
  /* PERBAIKAN: link yang di-copy lewat tombol "Share" di HP sering berbentuk
     youtube.com/watch?si=xxxxx&v=ID (parameter si= duluan, v= belakangan),
     atau youtube.com/shorts/ID?si=xxxxx. Regex lama hanya mengenali pola
     "watch?v=" persis di awal query string, jadi link seperti itu gagal
     dikenali dan videonya hilang/tidak tampil. Di sini kita parse URL-nya
     dengan benar (cari parameter v= di mana pun posisinya) dan baru jatuh
     ke regex lama sebagai cadangan kalau URL-nya tidak valid. */
  try{
    const withProtocol = /^https?:\/\//i.test(str) ? str : 'https://' + str.replace(/^\/\//,'');
    const u = new URL(withProtocol);
    const host = u.hostname.replace(/^www\.|^m\./i,'').toLowerCase();
    if(host === 'youtu.be'){
      const id = u.pathname.split('/').filter(Boolean)[0];
      if(id && /^[A-Za-z0-9_-]{6,}$/.test(id)) return id;
    }
    if(host === 'youtube.com' || host === 'music.youtube.com'){
      const v = u.searchParams.get('v');
      if(v && /^[A-Za-z0-9_-]{6,}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex(p=>['embed','shorts','live','v'].includes(p));
      if(idx !== -1 && parts[idx+1] && /^[A-Za-z0-9_-]{6,}$/.test(parts[idx+1])) return parts[idx+1];
    }
  }catch(e){
    // URL tidak valid -- lanjut ke regex cadangan di bawah
  }
  const m = str.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{6,})/);
  if(m) return m[1];
  return '';
}
function youtubeSubscribeUrl(){
  let ch = (DB.settings.youtubeChannelUrl||'').trim();
  if(!ch) return '';
  if(!/^https?:\/\//i.test(ch)){
    ch = ch.startsWith('@') ? `https://www.youtube.com/${ch}` : `https://www.youtube.com/@${ch}`;
  }
  const sep = ch.includes('?') ? '&' : '?';
  return `${ch}${sep}sub_confirmation=1`;
}
function openYoutubeVideo(idx, videoId){
  const box = document.getElementById('ytPlayer_'+idx);
  if(box) box.innerHTML = `<iframe class="w-full h-full rounded-xl" src="https://www.youtube.com/embed/${videoId}?autoplay=1" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  const subUrl = youtubeSubscribeUrl();
  if(subUrl) window.open(subUrl, '_blank');
}
function verifyHpAndEditRegistration(nomorRegistrasi){
  const list = DB.peserta.filter(p=>p.nomorRegistrasi===nomorRegistrasi);
  if(!list.length) return;
  Swal.fire({
    icon:'question',
    title:'Verifikasi Nomor HP',
    html:'Masukkan <b>Nomor HP Koordinator</b> yang digunakan saat mendaftar untuk membuka form perbaikan data.',
    input:'tel',
    inputPlaceholder:'08xxxxxxxxxx',
    showCancelButton:true,
    confirmButtonText:'Verifikasi',
    confirmButtonColor:'#2563EB',
    cancelButtonText:'Batal',
    preConfirm:(hp)=>{ if(!hp || !hp.trim()){ Swal.showValidationMessage('Nomor HP wajib diisi'); return false; } return hp.trim(); }
  }).then(res=>{
    if(!res.isConfirmed) return;
    const inputHp = normalizeHp(res.value);
    const savedHp = normalizeHp(list[0].hpKoordinator);
    if(!savedHp || inputHp!==savedHp){
      Swal.fire({icon:'error', title:'Nomor HP tidak sesuai', text:'Pastikan nomor HP sama dengan yang digunakan saat mendaftar. Jika lupa, hubungi panitia.', confirmButtonColor:'#E1122F'});
      return;
    }
    openPublicEditModal(list[0].kelompokId);
  });
}
function openPublicEditModal(kid){
  const rows = DB.peserta.filter(p=>p.kelompokId===kid); if(!rows.length) return;
  const first = rows[0];
  openModal(`<div class="p-6 max-h-[90vh] overflow-y-auto">
    <div class="flex items-center justify-between mb-4"><h3 class="font-display font-bold text-lg">Perbaiki Data Pendaftaran</h3><button onclick="closeModal()" class="text-zinc-400"><i class="fa-solid fa-xmark"></i></button></div>
    <form onsubmit="return savePublicEditedRegistration(event,'${kid}')" class="space-y-3 text-sm">
      <div><label class="lbl">Nama Koordinator</label><input id="pe_koordinator" class="inp" value="${escapeHtml(first.koordinator)}" required></div>
      <div><label class="lbl">Nomor HP Koordinator</label><input id="pe_hp" class="inp" type="tel" value="${escapeHtml(first.hpKoordinator||'')}" required></div>
      <div class="font-semibold text-sm pt-2">Data Pemain</div>
      <div class="space-y-3">${rows.map((p,i)=>`
        <div class="rounded-xl p-3 border border-zinc-200 dark:border-zinc-700 space-y-2">
          <div class="text-[10px] text-zinc-400 font-semibold uppercase">${kategoriNama(p.kategoriId)}${rows.filter(x=>x.kategoriId===p.kategoriId).length>1?' \u00B7 Peserta '+(p.slot||1):''}</div>
          <div><label class="lbl">Nama Lengkap</label><input id="pe_nama_${i}" class="inp" value="${escapeHtml(p.nama)}" required></div>
          <div><label class="lbl">Asal Sekolah</label><input id="pe_sekolah_${i}" class="inp" value="${escapeHtml(p.asalSekolah)}" required></div>
          <div>
            <input type="file" accept="image/*" class="hidden" id="pe_foto_${i}" onchange="previewPublicEditFoto(this,${i})">
            <div onclick="document.getElementById('pe_foto_${i}').click()" class="border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-2 text-center text-xs text-zinc-400 cursor-pointer flex items-center gap-2 justify-center">
              <img id="pe_fotoPreview_${i}" class="${p.foto?'':'hidden'} w-8 h-8 rounded-full object-cover" src="${p.foto||''}">
              <span id="pe_fotoLabel_${i}"><i class="fa-solid fa-camera mr-1"></i> ${p.foto?'Ganti foto':'Klik untuk unggah foto'}</span>
            </div>
          </div>
        </div>`).join('')}
      </div>
      <div class="text-xs text-zinc-400">Nomor registrasi &amp; Gugus tetap dipertahankan agar status pendaftaran tidak berubah.</div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn-ghost">Batal</button><button class="btn-primary"><i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan</button></div>
    </form>
  </div>`);
  window._peEditFoto = {};
}
function previewPublicEditFoto(input, idx){
  const file = input.files[0]; if(!file) return;
  resizeImageFile(file, 500, 0.85, 'image/jpeg').then(url=>{
    window._peEditFoto[idx] = url;
    const img = document.getElementById(`pe_fotoPreview_${idx}`); if(img){ img.src=url; img.classList.remove('hidden'); }
    const lbl = document.getElementById(`pe_fotoLabel_${idx}`); if(lbl) lbl.textContent = file.name;
  });
}
function savePublicEditedRegistration(e, kid){
  e.preventDefault();
  const rows = DB.peserta.filter(p=>p.kelompokId===kid);
  const koor = document.getElementById('pe_koordinator').value.trim();
  const hp = document.getElementById('pe_hp').value.trim();
  rows.forEach((p,i)=>{
    p.koordinator = koor;
    p.hpKoordinator = hp;
    const namaInp = document.getElementById(`pe_nama_${i}`); if(namaInp) p.nama = namaInp.value.trim();
    const sekInp = document.getElementById(`pe_sekolah_${i}`); if(sekInp) p.asalSekolah = sekInp.value.trim();
    if(window._peEditFoto && window._peEditFoto[i]) p.foto = window._peEditFoto[i];
  });
  saveDB();
  addLog('Pendaftaran', 'Peserta memperbaiki data sendiri \u2014 '+((rows[0] && rows[0].nomorRegistrasi)||''));
  closeModal();
  Swal.fire({toast:true, position:'top-end', icon:'success', title:'Data berhasil diperbarui', showConfirmButton:false, timer:1800});
  const q = document.getElementById('checkQuery'); if(q){ q.value = hp; doPesertaCheck(); }
  // PERBAIKAN: kirim perubahan ini LANGSUNG ke server lewat endpoint atomik
  // 'updatepeserta' (hanya mengubah baris yang id-nya cocok, tidak menimpa
  // seluruh database). Sebelumnya perbaikan data peserta hanya tersimpan di
  // perangkat peserta itu sendiri sampai ADMIN membuka aplikasi dan memicu
  // penyimpanan penuh -- yang berisiko malah menimpa balik dengan data lama
  // kalau salinan lokal admin belum ter-refresh. Sekarang tersimpan ke
  // server otomatis, sekalipun admin sedang offline/keluar tab.
  if(cloudSyncEnabled()){
    updatePesertaToCloud_(rows, (rows[0] && rows[0].nomorRegistrasi)||'').then(r=>{
      if(!r.ok) showCloudSaveToast_(false, r.reason);
    });
  }
  return false;
}

/* ---------- Upload helper (shared) ---------- */
function resizeImageFile(file, maxWidth, quality, mime){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        let w=img.width, h=img.height;
        if(w>maxWidth){ h=Math.round(h*maxWidth/w); w=maxWidth; }
        const c=document.createElement('canvas'); c.width=w; c.height=h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        resolve(c.toDataURL(mime||'image/jpeg', quality||0.85));
      };
      img.onerror=()=>reject(new Error('Gagal memuat gambar'));
      img.src = e.target.result;
    };
    reader.onerror=()=>reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

/* ---------- Auth ---------- */
let currentUser = null;
let sessionTimer = null;
function handleLogin(e){
  e.preventDefault();
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const found = DB.users.find(x=>x.username===u && x.password===p);
  if(!found){ Swal.fire({icon:'error', title:'Login gagal', text:'Username atau password tidak sesuai.', confirmButtonColor:'#2563EB'}); return false; }
  currentUser = found;
  persistSession(found.username);
  addLog('Login', `${found.nama} (${found.role}) masuk ke sistem`);
  ['landingScreen','registerScreen','regSuccessScreen','pesertaCheckScreen','loginScreen'].forEach(s=>{
    document.getElementById(s).classList.add('hidden');
  });
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('userNameTop').textContent = found.nama;
  document.getElementById('userAvatar').textContent = found.nama.slice(0,1).toUpperCase();
  buildSideNav(); renderBranding(); resetSessionTimer(); navigate('dashboard');
  Swal.fire({toast:true, position:'top-end', icon:'success', title:`Selamat datang, ${found.nama}`, showConfirmButton:false, timer:2000});
  return false;
}
function logout(){
  currentUser = null; clearTimeout(sessionTimer);
  clearSession();
  document.getElementById('app').classList.add('hidden');
  showScreen('landingScreen');
}
/* ---------- Session persistence (supaya tidak minta login ulang tiap refresh) ----------
   Sebelumnya status login (currentUser) hanya disimpan di variabel memori, sehingga
   hilang setiap kali halaman di-refresh. Sekarang username yang sedang login disimpan
   di SAFE_STORAGE (localStorage), dan dipulihkan otomatis saat aplikasi dibuka ulang,
   selama sesi belum kedaluwarsa (lihat sessionTimeoutMin di Pengaturan) dan user masih
   terdaftar di DB.users. */
function persistSession(username){
  try{ SAFE_STORAGE.setItem(SESSION_KEY, username); }catch(e){}
}
function clearSession(){
  try{ SAFE_STORAGE.removeItem(SESSION_KEY); }catch(e){}
}
function restoreSessionAndBoot(){
  let restored = false;
  try{
    const savedUsername = SAFE_STORAGE.getItem(SESSION_KEY);
    if(savedUsername){
      const found = (DB.users||[]).find(u=>u.username===savedUsername);
      if(found){
        currentUser = found;
        ['landingScreen','registerScreen','regSuccessScreen','pesertaCheckScreen','loginScreen'].forEach(s=>{
          const el = document.getElementById(s); if(el) el.classList.add('hidden');
        });
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('userNameTop').textContent = found.nama;
        document.getElementById('userAvatar').textContent = found.nama.slice(0,1).toUpperCase();
        buildSideNav(); renderBranding(); resetSessionTimer();
        navigate(location.hash.slice(1) || 'dashboard');
        restored = true;
      } else {
        clearSession();
      }
    }
  }catch(e){ /* kalau gagal pulihkan sesi, lanjut ke layar landing seperti biasa */ }
  if(!restored) showScreen('landingScreen');
}
function resetSessionTimer(){
  clearTimeout(sessionTimer);
  const mins = DB.settings.sessionTimeoutMin || 20;
  sessionTimer = setTimeout(()=>{ Swal.fire({icon:'warning', title:'Sesi Berakhir', text:`Anda keluar otomatis setelah ${mins} menit tidak aktif.`, confirmButtonColor:'#2563EB'}); logout(); }, mins*60*1000);
}
['click','keydown','mousemove','touchstart'].forEach(ev=>document.addEventListener(ev, ()=>{ if(currentUser) resetSessionTimer(); }));

/* ---------- Branding (logo + judul tab browser) ----------
   Judul tab browser & meta share (WhatsApp/Facebook dsb.) dibuat mengikuti
   nama turnamen yang diinput admin di Pengaturan, bukan lagi teks statis. */
function updatePageTitle(){
  const nama = turnamenPlainText();
  const title = nama ? `${nama} | Tournament Management System` : 'BADMINTIME | Tournament Management System';
  document.title = title;
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if(ogTitle) ogTitle.setAttribute('content', title);
  const twTitle = document.querySelector('meta[name="twitter:title"]');
  if(twTitle) twTitle.setAttribute('content', title);
}
function renderBranding(){
  const logo = DB.settings.logoUrl;
  const sb = document.getElementById('sidebarLogoBox');
  if(sb) sb.innerHTML = logo ? `<img src="${logo}" class="w-full h-full object-contain p-1">` : '\u{1F3F8}';
  document.getElementById('sidebarTitle').innerHTML = DB.settings.namaTurnamen;
  updatePageTitle();
}

/* ---------- Sidebar / Router ---------- */
const MENU = [
  {id:'dashboard', label:'Dashboard', icon:'fa-gauge-high'},
  {id:'peserta', label:'Peserta', icon:'fa-user-group', roles:['admin']},
  {id:'undian', label:'Undian', icon:'fa-dice', roles:['admin']},
  {id:'team', label:'Team', icon:'fa-people-group', roles:['admin']},
  {id:'pemain', label:'Pemain', icon:'fa-shuttlecock', roles:['admin']},
  {id:'jadwal', label:'Jadwal', icon:'fa-calendar-days'},
  {id:'bagan', label:'Bagan', icon:'fa-diagram-project'},
  {id:'skor', label:'Skor', icon:'fa-table-tennis-paddle-ball'},
  {id:'hasil', label:'Hasil', icon:'fa-ranking-star'},
  {id:'laporan', label:'Laporan', icon:'fa-chart-column'},
  {id:'backup', label:'Backup', icon:'fa-cloud-arrow-up', roles:['admin']},
  {id:'user', label:'Manajemen User', icon:'fa-users-gear', roles:['admin']},
  {id:'pengaturan', label:'Pengaturan', icon:'fa-gear', roles:['admin']},
];
function buildSideNav(){
  document.getElementById('sideNav').innerHTML = MENU.filter(m=>!m.roles||m.roles.includes(currentUser.role)).map(m=>`
    <a href="#${m.id}" data-nav="${m.id}" onclick="toggleSidebar(false)" class="nav-link flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/70 hover:bg-white/10 hover:text-white transition">
      <i class="fa-solid ${m.icon} w-4 text-center"></i><span>${m.label}</span>
    </a>`).join('') + `<button onclick="logout()" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/70 hover:bg-red-500/20 hover:text-red-300 transition mt-2"><i class="fa-solid fa-right-from-bracket w-4 text-center"></i><span>Keluar</span></button>`;
}
function setActiveNav(id){
  document.querySelectorAll('.nav-link').forEach(a=>{
    if(a.dataset.nav===id){ a.classList.add('bg-primary','text-white'); a.classList.remove('text-white/70'); }
    else { a.classList.remove('bg-primary','text-white'); a.classList.add('text-white/70'); }
  });
}
function toggleSidebar(force){
  const sb=document.getElementById('sidebar'), ov=document.getElementById('sidebarOverlay');
  const show = force!==undefined?force:sb.classList.contains('-translate-x-full');
  sb.classList.toggle('-translate-x-full', !show); ov.classList.toggle('hidden', !show);
}
function toggleUserMenu(){ document.getElementById('userMenu').classList.toggle('hidden'); }
document.addEventListener('click', e=>{
  if(!e.target.closest('#userMenu') && !e.target.closest('button[onclick^="toggleUserMenu"]')){ const _um=document.getElementById('userMenu'); if(_um) _um.classList.add('hidden'); }
  if(!e.target.closest('#searchResults') && e.target.id!=='globalSearch'){ const _sr=document.getElementById('searchResults'); if(_sr) _sr.classList.add('hidden'); }
});
window.addEventListener('hashchange', ()=>{ if(currentUser) navigate(location.hash.slice(1)||'dashboard'); });
function navigate(id){
  const allowed = MENU.filter(m=>!m.roles||m.roles.includes(currentUser.role)).map(m=>m.id);
  if(!allowed.includes(id)) id='dashboard';
  setActiveNav(id);
  const renderers = { dashboard:renderDashboard, peserta:renderPeserta, undian:renderUndian, team:renderTeam, pemain:renderPemain, jadwal:renderJadwal, bagan:renderBaganPage, skor:renderSkor, hasil:renderHasil, laporan:renderLaporan, backup:renderBackup, user:renderUserMgmt, pengaturan:renderPengaturan };
  (renderers[id]||renderDashboard)();
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ---------- Reusable UI ---------- */
function pageHeader(title, subtitle, actions){
  return `<div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
    <div><h1 class="font-display text-xl md:text-2xl font-bold">${title}</h1>${subtitle?`<p class="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">${subtitle}</p>`:''}</div>
    <div class="flex items-center gap-2 flex-wrap no-print">${actions||''}</div>
  </div>`;
}
function statCard(icon,label,value,color){
  return `<div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 fade-in">
    <div class="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style="background:${color}1A;color:${color}"><i class="fa-solid ${icon}"></i></div>
    <div class="text-2xl font-display font-bold">${value}</div><div class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${label}</div>
  </div>`;
}
function emptyState(icon,title,desc){
  return `<div class="text-center py-16 text-zinc-400"><i class="fa-solid ${icon} text-3xl mb-3"></i><div class="font-semibold text-zinc-500 dark:text-zinc-300">${title}</div><div class="text-xs mt-1 max-w-xs mx-auto">${desc}</div></div>`;
}
function openModal(html){
  document.getElementById('modalRoot').innerHTML = `<div class="fixed inset-0 z-40 modal-backdrop flex items-center justify-center p-4" onclick="if(event.target===this) closeModal()">
    <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-soft w-full max-w-2xl max-h-[90vh] overflow-y-auto fade-in">${html}</div></div>`;
}
/* Modal khusus untuk panel Input Skor (.score-modal sudah mengatur lebar/background/
   radius sendiri sampai 760px) \u2014 TIDAK memakai wrapper max-w-2xl (672px) milik
   openModal() karena itu memotong sisi kanan kartu skor (Team B & tombol Simpan). */
function openScoreModal(html){
  document.getElementById('modalRoot').innerHTML = `<div class="fixed inset-0 z-40 modal-backdrop flex items-center justify-center p-4" onclick="if(event.target===this) closeModal()">
    <div class="w-full max-h-[90vh] overflow-y-auto fade-in" style="max-width:760px;">${html}</div></div>`;
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
function teamNama(id){ return id ? (DB.teams.find(t=>t.id===id)||{}).nama || '-' : 'TBD'; }
/* Kode Slot tetap sebuah team (A\u2013H), independen dari nama Team yang bisa
   diganti admin \u2014 dipakai supaya pasangan lawan di Jadwal & Bagan selalu
   bisa diverifikasi sesuai aturan Slot A vs B, C vs D, E vs F, G vs H. */
function teamSlotKode(id){ const t = id ? DB.teams.find(x=>x.id===id) : null; return t && t.slotKey ? t.slotKey : ''; }
function isAdmin(){ return currentUser && currentUser.role==='admin'; }

/* ---------- DASHBOARD ---------- */
let chartStat=null;
function renderDashboard(){
  const totalTeam = DB.teams.length, totalPeserta = DB.peserta.length, totalLaga = DB.laga.length;
  const hariIni = DB.laga.filter(l=>l.tanggal===todayISO()).length;
  const selesai = DB.laga.filter(l=>l.status==='Selesai').length;
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Dashboard', DB.settings.namaTurnamen)}
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      ${statCard('fa-people-group','Jumlah Team', totalTeam, '#2563EB')}
      ${statCard('fa-user-group','Jumlah Peserta', totalPeserta, '#111827')}
      ${statCard('fa-shuttlecock','Total Pertandingan', totalLaga, '#0891B2')}
      ${statCard('fa-calendar-day','Hari Ini', hariIni, '#D97706')}
      ${statCard('fa-circle-check','Selesai', selesai, '#059669')}
      ${statCard('fa-trophy','Juara', DB.juaraTeamId?teamNama(DB.juaraTeamId):'-', '#F5B301')}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <div class="font-display font-semibold text-sm mb-4">Statistik Poin Team</div>
        <canvas id="chartStat" height="130"></canvas>
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <div class="font-display font-semibold text-sm mb-3"><i class="fa-regular fa-clock text-primary mr-1"></i> Aktivitas Terbaru</div>
        ${DB.logs.slice(0,6).map(l=>`<div class="py-2 border-b border-zinc-50 dark:border-zinc-800 last:border-0"><div class="text-xs font-medium">${escapeHtml(l.jenis)}</div><div class="text-[11px] text-zinc-400">${escapeHtml(l.ket)}</div></div>`).join('')}
      </div>
    </div>
    <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 mt-4">
      <div class="font-display font-semibold text-sm mb-3"><i class="fa-solid fa-calendar-day text-primary mr-1"></i> Pertandingan Hari Ini</div>
      ${DB.laga.filter(l=>l.tanggal===todayISO()).map(l=>`<div class="flex items-center justify-between py-2 border-b border-zinc-50 dark:border-zinc-800 last:border-0 text-sm">
        <span>${l.jam} \u00B7 Lap. ${l.lapangan} \u00B7 <b>${escapeHtml(teamNama(l.teamA))}</b> vs <b>${escapeHtml(teamNama(l.teamB))}</b></span>
        <span class="badge ${l.status==='Selesai'?'bg-emerald-100 text-emerald-700':l.status==='Sedang Main'?'bg-amber-100 text-amber-700':'bg-zinc-100 text-zinc-500'}">${l.status}</span>
      </div>`).join('') || emptyState('fa-calendar-check','Tidak ada jadwal hari ini','Jadwal akan tampil di sini setelah dibuat.')}
    </div>`;
  if(chartStat) chartStat.destroy();
  chartStat = new Chart(document.getElementById('chartStat'), { type:'bar', data:{ labels: DB.teams.map(t=>t.nama), datasets:[{label:'Poin', data:DB.teams.map(t=>t.poin), backgroundColor: DB.teams.map(t=>t.warna), borderRadius:6}] }, options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, ticks:{precision:0}}} } });
}

/* ---------- PESERTA ---------- */
let pesertaFilter='';
function renderPeserta(){
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Peserta','Kelola pendaftar & verifikasi', `
      <button onclick="toggleAllGugus(true)" class="btn-ghost"><i class="fa-solid fa-angles-down"></i> Buka Semua</button>
      <button onclick="toggleAllGugus(false)" class="btn-ghost"><i class="fa-solid fa-angles-up"></i> Tutup Semua</button>
      <button onclick="cancelSelectedRegistrations()" class="btn-ghost text-red-500"><i class="fa-solid fa-ban"></i> Batalkan Terpilih</button>
      ${isAdmin()?`<button onclick="cancelAllRegistrations()" class="btn-ghost text-red-500"><i class="fa-solid fa-trash-can"></i> Batalkan Semua</button>`:''}
      ${isAdmin()?`<button onclick="openImportPesertaModal()" class="btn-ghost"><i class="fa-solid fa-file-import text-primary"></i> Impor Excel</button>`:''}
      <button onclick="exportExcel('peserta')" class="btn-ghost"><i class="fa-solid fa-file-excel text-emerald-600"></i> Excel</button>`)}
    <div class="flex flex-col md:flex-row gap-2 mb-4">
      <input id="pesertaSearchInput" oninput="pesertaFilter=this.value;renderPesertaTable()" value="${escapeHtml(pesertaFilter)}" placeholder="Cari koordinator / pemain / sekolah / registrasi..." class="w-full md:w-96 bg-white/95 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40">
      <select onchange="filterPesertaGugus=this.value;renderPesertaTable()" class="inp md:w-56">
        <option value="">Semua Gugus</option>
        ${DB.gugus.map(g=>`<option value="${escapeHtml(g)}" ${window.filterPesertaGugus===g?'selected':''}>${escapeHtml(g)}</option>`).join('')}
      </select>
    </div>
    <div id="pesertaGugusContainer" class="space-y-4"></div>`;
  renderPesertaTable();
}
let filterPesertaGugus='';
let openGugusState={};
function renderPesertaTable(){
  let rows = DB.peserta.slice().sort((a,b)=> new Date(b.waktuDaftar)-new Date(a.waktuDaftar));
  if(pesertaFilter) rows = rows.filter(p=>(p.nama+p.asalSekolah+p.nomorRegistrasi+p.koordinator).toLowerCase().includes(pesertaFilter.toLowerCase()));
  if(filterPesertaGugus) rows = rows.filter(p=>p.gugus===filterPesertaGugus);
  const groups = [...new Set(rows.map(p=>p.gugus||'Tanpa Gugus'))];
  const wrap=document.getElementById('pesertaGugusContainer'); if(!wrap) return;
  wrap.innerHTML = groups.map((g,gi)=>{
    const color=gugusColor(g);
    const groupRows=rows.filter(p=>(p.gugus||'Tanpa Gugus')===g);
    const open=openGugusState[g]!==false;
    const groupIds=[...new Set(groupRows.map(p=>p.kelompokId))];
    const pendingCount = groupRows.filter(p=>p.status==='Menunggu Verifikasi').length;
    return `<section class="gugus-panel rounded-2xl shadow-softer border border-zinc-200 dark:border-zinc-700 overflow-hidden" style="--gcolor:${color}">
      <div class="w-full flex items-center gap-3 px-4 py-3">
        <button onclick="toggleGugus('${escapeHtml(g)}')" class="flex items-center gap-3 flex-1 min-w-0 text-left">
          <span class="w-3 h-3 rounded-full shrink-0" style="background:${color}"></span>
          <div class="flex-1 min-w-0"><div class="font-display font-bold text-sm truncate">${escapeHtml(g)}</div><div class="text-[11px] text-zinc-400">${groupIds.length} pendaftaran \u00B7 ${groupRows.length} pemain</div></div>
          <span class="badge shrink-0" style="background:${color};color:#fff">${groupRows.filter(p=>p.status==='Terverifikasi').length} terverifikasi</span>
        </button>
        ${isAdmin() && pendingCount>0 ? `<button onclick="verifySemuaGugus('${escapeHtml(g)}')" class="btn-primary text-[11px] !py-1.5 !px-2.5 shrink-0" title="Verifikasi ${pendingCount} peserta yang masih menunggu di gugus ini"><i class="fa-solid fa-check-double"></i> Verifikasi Semua (${pendingCount})</button>` : ''}
        <button onclick="toggleGugus('${escapeHtml(g)}')" class="shrink-0 px-1"><i class="fa-solid fa-chevron-${open?'up':'down'} text-xs text-zinc-400"></i></button>
      </div>
      <div class="${open?'':'hidden'} border-t border-zinc-200/70 dark:border-zinc-700">
        ${groupIds.map(kid=>{
          const regRows=groupRows.filter(p=>p.kelompokId===kid);
          const first=regRows[0];
          const regColor=teamColor(first && first.teamId);
          return `<div class="p-3 md:p-4 border-b last:border-b-0 border-zinc-200/70 dark:border-zinc-700">
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <input type="checkbox" class="reg-select w-4 h-4" value="${kid}">
              <span class="font-mono text-[11px] text-zinc-400">${escapeHtml(first.nomorRegistrasi)}</span>
              <span class="badge" style="background:${regColor};color:white">${first.teamId?escapeHtml(teamNama(first.teamId)):'Team belum tersedia'}</span>
              <span class="badge bg-amber-100 text-amber-700">${regRows[0].status}</span>
              <span class="ml-auto text-[11px] text-zinc-400">Koordinator: <b class="text-zinc-700 dark:text-zinc-200">${escapeHtml(first.koordinator)}</b></span>
              <button onclick="editRegistration('${kid}')" class="icon-btn text-primary" title="Perbaiki data"><i class="fa-solid fa-pen"></i></button>
              <button onclick="cancelRegistration('${kid}')" class="icon-btn text-red-500" title="Batalkan pendaftaran"><i class="fa-solid fa-ban"></i></button>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="text-left text-[11px] text-zinc-500"><tr><th class="px-2 py-2">Pemain</th><th class="px-2 py-2">Sekolah</th><th class="px-2 py-2">Kategori</th><th class="px-2 py-2">Robah Pemain</th><th class="px-2 py-2">Status</th><th class="px-2 py-2 text-right">Aksi</th></tr></thead>
                <tbody>${regRows.map(p=>`<tr class="border-t border-zinc-100 dark:border-zinc-800">
                  <td class="px-2 py-2 font-medium">
                    <button onclick="viewPesertaFotoById('${p.id}')" class="flex items-center gap-2 text-left hover:text-primary group/foto" title="${p.foto?'Lihat foto':'Belum ada foto'}">
                      ${p.foto?`<img src="${p.foto}" class="w-7 h-7 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0">`:`<div class="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-400 shrink-0"><i class="fa-solid fa-user text-[10px]"></i></div>`}
                      <span>${escapeHtml(p.nama)}</span>
                      <i class="fa-solid fa-eye text-[10px] ${p.foto?'text-zinc-400 group-hover/foto:text-primary':'text-zinc-300'}"></i>
                    </button>
                  </td>
                  <td class="px-2 py-2 text-xs text-zinc-500">${escapeHtml(p.asalSekolah)}</td>
                  <td class="px-2 py-2 text-xs"><span class="team-color-chip" style="background:${(KATEGORI_COLORS[p.kategoriId]||{}).border||'#64748B'}"></span> ${escapeHtml(p.kategori.map(kategoriNama).join(', '))}</td>
                  <td class="px-2 py-2">${robahPemainSelect(p, regRows)}</td>
                  <td class="px-2 py-2"><span class="badge ${p.status==='Terverifikasi'?'bg-emerald-100 text-emerald-700':p.status==='Ditolak'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}">${p.status}</span></td>
                  <td class="px-2 py-2 text-right whitespace-nowrap">
                    ${p.status==='Menunggu Verifikasi'?`<button onclick="verifPeserta('${p.id}',true)" class="icon-btn text-emerald-600"><i class="fa-solid fa-check"></i></button><button onclick="verifPeserta('${p.id}',false)" class="icon-btn text-red-500"><i class="fa-solid fa-xmark"></i></button>`:''}
                  </td>
                </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
  }).join('') || `<div class="bg-white/95 dark:bg-zinc-900 rounded-xl2 p-8 text-center text-zinc-400">${emptyState('fa-user-group','Belum ada peserta','Peserta akan muncul di sini setelah mendaftar lewat halaman publik.')}</div>`;
}
/* Fitur "mata" -- klik nama atau foto pemain di Daftar Peserta untuk melihat
   foto peserta ukuran penuh dalam modal. Diambil dari DB.peserta lewat id
   (bukan menempelkan foto base64 di setiap baris tabel) supaya tabel dengan
   banyak peserta tetap ringan. */
function viewPesertaFotoById(id){
  const p = DB.peserta.find(x=>x.id===id);
  if(!p) return;
  if(!p.foto){
    Swal.fire({toast:true, position:'top-end', icon:'info', title:'Peserta ini belum mengunggah foto', showConfirmButton:false, timer:1800});
    return;
  }
  openModal(`<div class="p-4">
    <div class="flex items-center justify-between mb-3">
      <div>
        <h3 class="font-display font-bold text-sm">${escapeHtml(p.nama)}</h3>
        <div class="text-[11px] text-zinc-400">${escapeHtml(p.asalSekolah||'')}</div>
      </div>
      <button onclick="closeModal()" class="text-zinc-400"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <img src="${p.foto}" class="w-full max-h-[70vh] object-contain rounded-xl mx-auto bg-zinc-100 dark:bg-zinc-800">
  </div>`);
}
function toggleGugus(g){ openGugusState[g]=!(openGugusState[g]!==false); renderPesertaTable(); }
function toggleAllGugus(open){ DB.gugus.forEach(g=>openGugusState[g]=open); renderPesertaTable(); }

/* ---------- Impor Peserta dari Excel (per Gugus) ----------
   Admin memilih SATU Gugus, lalu mengunggah file Excel berisi banyak
   pendaftaran sekaligus. Baris dengan Nama Koordinator + No HP yang sama
   digabung menjadi satu pendaftaran (kelompokId + nomorRegistrasi), persis
   seperti alur pendaftaran publik (submitRegister), supaya konsisten dengan
   struktur data peserta yang ada. */
function openImportPesertaModal(){
  if(!DB.gugus.length){
    Swal.fire({icon:'info', title:'Belum ada Gugus', text:'Tambahkan Gugus terlebih dahulu di menu Pengaturan sebelum mengimpor peserta.', confirmButtonColor:'#2563EB'});
    return;
  }
  openModal(`<div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-display font-bold text-lg"><i class="fa-solid fa-file-excel text-emerald-600 mr-1.5"></i> Impor Peserta dari Excel</h3>
      <button onclick="closeModal()" class="text-zinc-400"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="space-y-4 text-sm">
      <div>
        <label class="lbl">Pilih Gugus <span class="text-red-500">*</span></label>
        <select id="importPesertaGugus" class="inp">
          <option value="" disabled selected>\u2014 Pilih Gugus \u2014</option>
          ${DB.gugus.map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}
        </select>
        <div class="text-[11px] text-zinc-400 mt-1">Seluruh peserta dari file yang diunggah akan dimasukkan ke Gugus ini.</div>
      </div>
      <button type="button" onclick="downloadPesertaTemplate()" class="btn-ghost w-full justify-center"><i class="fa-solid fa-download"></i> Unduh Template Excel</button>
      <div>
        <label class="lbl">Unggah File Excel (.xlsx)</label>
        <input type="file" accept=".xlsx,.xls" onchange="importPesertaExcel(this)" class="inp">
      </div>
      <div class="text-[11px] text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2">
        Gunakan template di atas agar kolomnya sesuai. Baris dengan <b>Nama Koordinator</b> &amp; <b>No HP Koordinator</b> yang sama otomatis digabung jadi satu pendaftaran. Kategori Ganda/Mix Double perlu 2 baris (1 baris per pemain). Status peserta hasil impor langsung <b>Terverifikasi</b>.
      </div>
    </div>
  </div>`);
}
function downloadPesertaTemplate(){
  const gugusSelect = document.getElementById('importPesertaGugus');
  const gugus = gugusSelect ? gugusSelect.value : '';
  if(!gugus){ Swal.fire({icon:'warning', title:'Pilih Gugus terlebih dahulu', text:'Pilih Gugus sebelum mengunduh template Excel.', confirmButtonColor:'#2563EB'}); return; }
  const contoh = [
    {'Nama Koordinator':'Ahmad Fauzi','No HP Koordinator':'081234567890','GUGUS':gugus,'Kategori':'Tunggal Putra','Nama Pemain':'Budi Santoso','Asal Sekolah Pemain':''},
    {'Nama Koordinator':'Ahmad Fauzi','No HP Koordinator':'081234567890','GUGUS':gugus,'Kategori':'Tunggal Putri','Nama Pemain':'Siti Aminah','Asal Sekolah Pemain':''},
    {'Nama Koordinator':'Ahmad Fauzi','No HP Koordinator':'081234567890','GUGUS':gugus,'Kategori':'Ganda Putra','Nama Pemain':'Rudi Hartono','Asal Sekolah Pemain':''},
    {'Nama Koordinator':'Ahmad Fauzi','No HP Koordinator':'081234567890','GUGUS':gugus,'Kategori':'Ganda Putra','Nama Pemain':'Joko Susilo','Asal Sekolah Pemain':''},
    {'Nama Koordinator':'Ahmad Fauzi','No HP Koordinator':'081234567890','GUGUS':gugus,'Kategori':'Ganda Putri','Nama Pemain':'Rina Wulandari','Asal Sekolah Pemain':''},
    {'Nama Koordinator':'Ahmad Fauzi','No HP Koordinator':'081234567890','GUGUS':gugus,'Kategori':'Ganda Putri','Nama Pemain':'Dewi Lestari','Asal Sekolah Pemain':''},
    {'Nama Koordinator':'Ahmad Fauzi','No HP Koordinator':'081234567890','GUGUS':gugus,'Kategori':'Mix Double','Nama Pemain':'Andi Saputra','Asal Sekolah Pemain':''},
    {'Nama Koordinator':'Ahmad Fauzi','No HP Koordinator':'081234567890','GUGUS':gugus,'Kategori':'Mix Double','Nama Pemain':'Maya Sari','Asal Sekolah Pemain':''},
  ];
  const ws = XLSX.utils.json_to_sheet(contoh);
  ws['!cols'] = [{wch:20},{wch:18},{wch:24},{wch:16},{wch:20},{wch:22}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data Peserta');
  const petunjuk = [
    {Kolom:'Nama Koordinator', Keterangan:'Nama penanggung jawab pendaftaran. Baris dengan Nama Koordinator + No HP yang SAMA dikelompokkan jadi satu pendaftaran.'},
    {Kolom:'No HP Koordinator', Keterangan:'Nomor HP koordinator, dipakai peserta untuk cek status pendaftaran.'},
    {Kolom:'GUGUS', Keterangan:'Nama sekolah/tim (gugus). Dipakai sebagai asal sekolah default bila kolom Asal Sekolah Pemain dikosongkan.'},
    {Kolom:'Kategori', Keterangan:'Isi salah satu persis: Tunggal Putra, Tunggal Putri, Ganda Putra, Ganda Putri, Mix Double.'},
    {Kolom:'Nama Pemain', Keterangan:'Nama lengkap pemain. Untuk kategori Ganda/Mix Double, buat 2 baris terpisah dengan Kategori & Koordinator yang sama.'},
    {Kolom:'Asal Sekolah Pemain', Keterangan:'Opsional \u2014 kosongkan jika sama dengan GUGUS.'},
  ];
  const ws2 = XLSX.utils.json_to_sheet(petunjuk);
  ws2['!cols'] = [{wch:20},{wch:85}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Petunjuk');
  XLSX.writeFile(wb, `data peserta_GUGUS ${gugus}.xlsx`);
  addLog('Pendaftaran','Mengunduh template Excel Impor Peserta ('+gugus+')');
}
function importPesertaExcel(input){
  const gugusSelect = document.getElementById('importPesertaGugus');
  const gugus = gugusSelect ? gugusSelect.value : '';
  if(!gugus){ Swal.fire({icon:'warning', title:'Pilih Gugus terlebih dahulu', confirmButtonColor:'#2563EB'}); input.value=''; return; }
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      if(!rows.length) throw new Error('empty');
      const katByName = {};
      KATEGORI.forEach(k=>{ katByName[k.nama.toLowerCase()] = k.id; katByName[k.id.toLowerCase()] = k.id; });
      const groups = {};
      const groupOrder = [];
      let skipped = 0;
      rows.forEach(r=>{
        const koordinator = String(r['Nama Koordinator']||r['Koordinator']||'').trim();
        const hp = String(r['No HP Koordinator']||r['HP Koordinator']||r['No HP']||'').trim();
        const sekolahTim = String(r['GUGUS']||r['Gugus']||r['Asal Sekolah/Tim']||r['Asal Sekolah']||'').trim();
        const katRaw = String(r['Kategori']||'').trim().toLowerCase();
        const namaPemain = String(r['Nama Pemain']||r['Nama']||'').trim();
        const sekolahPemain = String(r['Asal Sekolah Pemain']||'').trim();
        const kid = katByName[katRaw];
        if(!koordinator || !namaPemain || !kid){ skipped++; return; }
        const gkey = (koordinator+'|'+hp).toLowerCase();
        if(!groups[gkey]){ groups[gkey] = { koordinator, hp, sekolahTim, kategoriMap:{} }; groupOrder.push(gkey); }
        if(!groups[gkey].kategoriMap[kid]) groups[gkey].kategoriMap[kid] = [];
        groups[gkey].kategoriMap[kid].push({ nama:namaPemain, asalSekolah: sekolahPemain || sekolahTim || '' });
      });
      if(!groupOrder.length) throw new Error('novalid');
      let totalPemain = 0, totalPendaftaran = 0, seq = DB.peserta.length;
      groupOrder.forEach(gkey=>{
        const g = groups[gkey];
        seq++;
        const nomorRegistrasi = `REG-${new Date().getFullYear()}-${String(seq).padStart(4,'0')}`;
        const kelompokId = uid('grp');
        const waktuDaftar = new Date().toISOString();
        Object.keys(g.kategoriMap).forEach(kid=>{
          g.kategoriMap[kid].forEach((pl,i)=>{
            const p = {
              id: uid('psr'), kelompokId, nomorRegistrasi,
              koordinator: g.koordinator, hpKoordinator: g.hp,
              nama: pl.nama, asalSekolah: pl.asalSekolah || g.sekolahTim,
              gugus, kategori:[kid], kategoriId:kid, slot:i+1,
              foto:'', status:'Terverifikasi',
              teamId: null, waktuDaftar
            };
            DB.peserta.push(p);
            syncToGoogleSheet('PESERTA','create',p);
            totalPemain++;
          });
        });
        totalPendaftaran++;
      });
      resyncPesertaTeamLinks();
      const linkedTeam = DB.teams.find(t=>t.gugus===gugus);
      if(linkedTeam){ syncTeamMeta(linkedTeam); syncToGoogleSheet('TEAM','update',linkedTeam); }
      saveDB();
      addLog('Pendaftaran', `Impor Excel: ${totalPendaftaran} pendaftaran (${totalPemain} pemain) untuk Gugus ${gugus}`);
      closeModal();
      renderPeserta();
      Swal.fire({icon:'success', title:'Impor selesai', text:`${totalPendaftaran} pendaftaran (${totalPemain} pemain) berhasil ditambahkan ke Gugus ${gugus}.${skipped?` ${skipped} baris dilewati karena data tidak lengkap atau kategori tidak dikenali.`:''}`, confirmButtonColor:'#2563EB'});
    }catch(err){
      Swal.fire({icon:'error', title:'Gagal membaca file', text:'Pastikan format file sesuai template (kolom Nama Koordinator, No HP Koordinator, Kategori, Nama Pemain terisi dengan benar).', confirmButtonColor:'#E1122F'});
    }
    input.value = '';
  };
  reader.readAsArrayBuffer(file);
}

/* ---------- Robah Pemain (tukar pemain antar kategori dalam 1 pendaftaran/gugus) ----------
   Setiap pendaftaran (kelompokId) berisi kumpulan pemain dari semua kategori yang didaftarkan
   (mis. Tunggal Putra 1 + Tunggal Putri 1 + Ganda Putra 2 + Ganda Putri 2 + Mix Double 2 = 8 pemain).
   Admin bisa memilih salah satu dari pemain tsb untuk mengisi slot kategori lain. Nama & asal
   sekolah baris tujuan otomatis berubah mengikuti pemain yang dipilih, dan pemain yang sudah
   dipakai akan hilang dari pilihan baris lain (pool otomatis berkurang: 8 -> 7 -> 6 -> ...). */
function robahPemainSelect(p, regRows){
  regRows.forEach(r=>{ if(r.namaAsli===undefined){ r.namaAsli=r.nama; r.sekolahAsli=r.asalSekolah; } });
  const usedIds = new Set(regRows.map(r=>r.robahSourceId).filter(Boolean));
  const sisa = regRows.length - usedIds.size;
  const options = regRows.filter(cand=>cand.id!==p.id && (!usedIds.has(cand.id) || cand.id===p.robahSourceId));
  return `<select onchange="robahPemain('${p.id}', this.value)" class="inp text-xs py-1.5 w-full min-w-[170px]">
      <option value="">\u2014 Nama asli: ${escapeHtml(p.namaAsli)} \u2014</option>
      ${options.map(cand=>`<option value="${cand.id}" ${p.robahSourceId===cand.id?'selected':''}>${escapeHtml(cand.namaAsli)} (${escapeHtml(kategoriNama(cand.kategoriId))})</option>`).join('')}
    </select>
    <div class="text-[10px] text-zinc-400 mt-0.5">Sisa ${sisa} dari ${regRows.length} pemain tersedia</div>`;
}
function robahPemain(rowId, candId){
  const p = DB.peserta.find(x=>x.id===rowId); if(!p) return;
  const rows = DB.peserta.filter(x=>x.kelompokId===p.kelompokId);
  rows.forEach(r=>{ if(r.namaAsli===undefined){ r.namaAsli=r.nama; r.sekolahAsli=r.asalSekolah; } });
  if(!candId){
    p.nama = p.namaAsli; p.asalSekolah = p.sekolahAsli; delete p.robahSourceId;
    addLog('Pendaftaran', `Mengembalikan pemain kategori ${kategoriNama(p.kategoriId)} ke nama asli (${p.nama})`);
  } else {
    const cand = rows.find(x=>x.id===candId); if(!cand) return;
    p.nama = cand.namaAsli; p.asalSekolah = cand.sekolahAsli; p.robahSourceId = candId;
    addLog('Pendaftaran', `Mengubah pemain kategori ${kategoriNama(p.kategoriId)} menjadi ${p.nama}`);
  }
  saveDB();
  syncToGoogleSheet('PESERTA','update',p);
  renderPesertaTable();
}
function selectedRegistrationIds(){ return [...document.querySelectorAll('.reg-select:checked')].map(x=>x.value); }
function cancelSelectedRegistrations(){
  const ids=selectedRegistrationIds(); if(!ids.length){ Swal.fire({icon:'info',title:'Belum ada pendaftaran dipilih',confirmButtonColor:'#E1122F'});return; }
  confirmCancelRegistrations(ids);
}
function cancelAllRegistrations(){
  const ids=[...new Set(DB.peserta.map(p=>p.kelompokId).filter(Boolean))];
  if(!ids.length) return;
  confirmCancelRegistrations(ids,true);
}
function confirmCancelRegistrations(ids,all=false){
  Swal.fire({icon:'warning',title:all?'Batalkan semua pendaftaran?':'Batalkan pendaftaran terpilih?',text:'Data peserta akan dihapus dari daftar pendaftaran dan hubungan team-nya dikosongkan.',showCancelButton:true,confirmButtonColor:'#E1122F',confirmButtonText:'Ya, batalkan'}).then(r=>{
    if(!r.isConfirmed)return;
    const affectedGugus = [...new Set(DB.peserta.filter(p=>ids.includes(p.kelompokId)).map(p=>p.gugus))];
    ids.forEach(kid=>{
      DB.peserta.filter(p=>p.kelompokId===kid).forEach(p=>syncToGoogleSheet('PESERTA','delete',p));
    });
    DB.peserta=DB.peserta.filter(p=>!ids.includes(p.kelompokId));
    resyncPesertaTeamLinks();
    affectedGugus.forEach(g=>{ const t=DB.teams.find(x=>x.gugus===g); if(t){ syncTeamMeta(t); syncToGoogleSheet('TEAM','update',t); } });
    saveDB(); addLog('Pendaftaran',`${all?'Membatalkan seluruh':'Membatalkan'} ${ids.length} pendaftaran`);
    renderPeserta();
    Swal.fire({toast:true,position:'top-end',icon:'success',title:'Pendaftaran dibatalkan',showConfirmButton:false,timer:1600});
  });
}
function cancelRegistration(kid){ confirmCancelRegistrations([kid]); }
function editRegistration(kid){
  const rows=DB.peserta.filter(p=>p.kelompokId===kid); if(!rows.length)return;
  const first=rows[0];
  openModal(`<div class="p-6 max-h-[90vh] overflow-y-auto">
    <div class="flex items-center justify-between mb-4"><h3 class="font-display font-bold text-lg">Perbaiki Data Pendaftaran</h3><button onclick="closeModal()" class="text-zinc-400"><i class="fa-solid fa-xmark"></i></button></div>
    <form onsubmit="return saveEditedRegistration(event,'${kid}')" class="space-y-3 text-sm">
      <div class="grid grid-cols-2 gap-2">
        <div><label class="lbl">Nama Koordinator</label><input id="e_koordinator" class="inp" value="${escapeHtml(first.koordinator)}" required></div>
        <div><label class="lbl">Asal Sekolah</label><input id="e_sekolah" class="inp" value="${escapeHtml(first.asalSekolah)}" required></div>
      </div>
      <div><label class="lbl">Gugus</label><select id="e_gugus" class="inp">${DB.gugus.map(g=>`<option ${g===first.gugus?'selected':''}>${escapeHtml(g)}</option>`).join('')}</select></div>
      <div class="font-semibold text-sm pt-2">Data Pemain</div>
      <div class="space-y-2">${rows.map((p,i)=>`<div class="rounded-xl p-3 border border-zinc-200 dark:border-zinc-700">
        <div class="text-[10px] text-zinc-400 mb-1">${kategoriNama(p.kategoriId)} \u00B7 Pemain ${p.slot||1}</div>
        <input id="e_player_${i}" class="inp" value="${escapeHtml(p.nama)}" required>
      </div>`).join('')}</div>
      <div class="text-xs text-zinc-400">Nomor registrasi tetap dipertahankan agar peserta dapat tetap mengecek status menggunakan nomor HP koordinator.</div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn-ghost">Batal</button><button class="btn-primary"><i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan</button></div>
    </form>
  </div>`);
}
function saveEditedRegistration(e,kid){
  e.preventDefault(); const rows=DB.peserta.filter(p=>p.kelompokId===kid);
  const koor=document.getElementById('e_koordinator').value.trim(), sekolah=document.getElementById('e_sekolah').value.trim(), gugus=document.getElementById('e_gugus').value;
  const oldGugus = rows[0] && rows[0].gugus;
  rows.forEach((p,i)=>{p.koordinator=koor;p.asalSekolah=sekolah;p.gugus=gugus;const inp=document.getElementById(`e_player_${i}`);if(inp)p.nama=inp.value.trim();syncToGoogleSheet('PESERTA','update',p);});
  resyncPesertaTeamLinks();
  [oldGugus, gugus].forEach(g=>{ if(!g) return; const t=DB.teams.find(x=>x.gugus===g); if(t){ syncTeamMeta(t); syncToGoogleSheet('TEAM','update',t); } });
  saveDB();addLog('Pendaftaran','Memperbaiki data pendaftaran '+((rows[0] && rows[0].nomorRegistrasi)||''));closeModal();renderPeserta();return false;
}
function verifPeserta(id, ok){
  const p = DB.peserta.find(x=>x.id===id); if(!p) return;
  p.status = ok?'Terverifikasi':'Ditolak';
  const regRows=DB.peserta.filter(x=>x.kelompokId===p.kelompokId);
  const team=p.teamId?DB.teams.find(t=>t.id===p.teamId):null;
  if(team) team.statusPendaftaran = regRows.every(x=>x.status==='Terverifikasi')?'Terverifikasi':(regRows.some(x=>x.status==='Ditolak')?'Perlu Perbaikan':'Menunggu Verifikasi');
  saveDB();
  addLog('Verifikasi', `${ok?'Memverifikasi':'Menolak'} peserta ${p.nama}`);
  syncToGoogleSheet('PESERTA','update',p);
  renderPesertaTable();
}
/* ---------- Verifikasi semua peserta dalam satu gugus sekaligus ----------
   Melengkapi verifPeserta() (satu per satu): tombol "Verifikasi Semua" di
   header tiap gugus supaya admin tidak perlu klik centang satu-satu kalau
   semua data di gugus itu sudah benar. Hanya peserta berstatus "Menunggu
   Verifikasi" yang diubah -- peserta yang sudah "Ditolak" TIDAK ikut
   otomatis diverifikasi (harus dicek manual satu per satu lewat tombol
   centang), supaya penolakan yang sudah diputuskan admin tidak tertimpa
   tanpa sengaja. */
function verifySemuaGugus(gugus){
  const targets = DB.peserta.filter(p=>(p.gugus||'Tanpa Gugus')===gugus && p.status==='Menunggu Verifikasi');
  if(!targets.length){
    Swal.fire({toast:true, position:'top-end', icon:'info', title:'Tidak ada peserta yang menunggu verifikasi di gugus ini', showConfirmButton:false, timer:1800});
    return;
  }
  Swal.fire({
    icon:'question',
    title:`Verifikasi semua peserta di "${gugus}"?`,
    text:`${targets.length} peserta yang berstatus "Menunggu Verifikasi" di gugus ini akan langsung diverifikasi. Peserta yang sudah ditolak tidak ikut berubah.`,
    showCancelButton:true,
    confirmButtonColor:'#059669',
    confirmButtonText:'Ya, verifikasi semua',
    cancelButtonText:'Batal'
  }).then(r=>{
    if(!r.isConfirmed) return;
    const affectedTeams = new Set();
    targets.forEach(p=>{
      p.status = 'Terverifikasi';
      if(p.teamId) affectedTeams.add(p.teamId);
      syncToGoogleSheet('PESERTA','update',p);
    });
    affectedTeams.forEach(tid=>{
      const team = DB.teams.find(t=>t.id===tid); if(!team) return;
      const regRows = DB.peserta.filter(x=>x.teamId===tid);
      team.statusPendaftaran = regRows.every(x=>x.status==='Terverifikasi')?'Terverifikasi':(regRows.some(x=>x.status==='Ditolak')?'Perlu Perbaikan':'Menunggu Verifikasi');
      syncToGoogleSheet('TEAM','update',team);
    });
    saveDB();
    addLog('Verifikasi', `Memverifikasi semua (${targets.length} peserta) di gugus ${gugus}`);
    renderPesertaTable();
    Swal.fire({toast:true, position:'top-end', icon:'success', title:`${targets.length} peserta di "${gugus}" berhasil diverifikasi`, showConfirmButton:false, timer:2000});
  });
}

/* ---------- TEAM ---------- */
/* ---------- UNDIAN (roda putar penentu Gugus per Slot Team A-H) ----------
   Menggantikan langkah manual "pilih Gugus" satu-satu di kartu Team. Admin
   memutar roda untuk tiap Slot (A, B, C, ... sesuai urutan slotKey Team yang
   sudah ada); hasilnya LANGSUNG dipanggil lewat assignGugusToTeam() -- fungsi
   yang sama yang sudah dipakai kartu Team -- sehingga otomatis: mengisi
   team.gugus, menyusun ulang peserta ke Team terkait (resyncPesertaTeamLinks),
   menyimpan (saveDB -> tersinkron ke cloud), dan tercatat di Log Aktivitas.
   Admin TIDAK perlu lagi input manual Gugus di menu Team.
   State (Gugus mana yang sudah/belum diundi, Slot mana yang sudah terisi)
   SENGAJA tidak disimpan terpisah -- selalu dihitung ulang dari DB.gugus &
   DB.teams[].gugus setiap halaman dibuka (undianComputeState_), supaya kalau
   ada perubahan dari perangkat lain (mis. admin lain menghapus/menambah
   Gugus di Pengaturan) datanya selalu konsisten, tanpa risiko data ganda. */
window._undian = { candidates:[], angle:0, spinning:false, pendingIdx:-1, audioCtx:null };
function undianComputeState_(){
  const teamsWithSlot = DB.teams.filter(t=>t.slotKey).slice().sort((a,b)=>a.slotKey.localeCompare(b.slotKey));
  const assigned = new Set(teamsWithSlot.filter(t=>t.gugus).map(t=>t.gugus));
  const candidates = DB.gugus.filter(g=>!assigned.has(g));
  const nextTeam = teamsWithSlot.find(t=>!t.gugus) || null;
  return { teamsWithSlot, candidates, nextTeam };
}
function renderUndian(){
  const { teamsWithSlot, candidates, nextTeam } = undianComputeState_();
  window._undian.candidates = candidates.slice();
  window._undian.angle = 0;
  window._undian.spinning = false;
  window._undian.pendingIdx = -1;
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Undian Gugus','Putar roda untuk menentukan Gugus di tiap Slot Team \u2014 hasilnya otomatis masuk ke menu Team, tidak perlu input manual lagi.', teamsWithSlot.some(t=>t.gugus)?`<button onclick="undianReset_()" class="btn-ghost text-red-500 no-print"><i class="fa-solid fa-rotate-left"></i> Undi Ulang Semua</button>`:'')}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <h3 class="font-display font-bold text-sm mb-1"><i class="fa-solid fa-list-ol text-primary mr-1"></i> Gugus Menunggu Diundi</h3>
        <p class="text-[11px] text-zinc-400 mb-3">Daftar Gugus diambil otomatis dari Pengaturan &rarr; Master Gugus.</p>
        <ul id="undianCandidateList" class="space-y-1.5 max-h-[420px] overflow-y-auto"></ul>
      </div>
      <div class="undian-wheel-wrap">
        <div class="undian-wheel-inner">
          <div class="undian-pointer"></div>
          <canvas id="undianWheel" width="380" height="380"></canvas>
          <button class="undian-spin-btn" id="undianSpinBtn" onclick="undianSpin_()">PUTAR<br>RODA</button>
          <div class="undian-winner-modal" id="undianWinnerModal">
            <h4 id="undianSlotTitleText">HASIL UNDIAN:</h4>
            <div class="undian-winner-name" id="undianWinnerNameText"></div>
            <button class="continue-btn btn-primary" style="border-radius:8px" onclick="undianContinue_()">LANJUTKAN</button>
          </div>
        </div>
        <div id="undianStatusText" class="text-xs text-zinc-500 dark:text-zinc-400 mt-4 text-center max-w-xs"></div>
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-4 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <h3 class="font-display font-bold text-sm mb-1"><i class="fa-solid fa-trophy text-primary mr-1"></i> Hasil Undian per Slot</h3>
        <p class="text-[11px] text-zinc-400 mb-2.5">Otomatis tersimpan ke kartu Team masing-masing slot.</p>
        <div id="undianSlotContainer"></div>
      </div>
    </div>`;
  undianRenderCandidateList_();
  undianRenderSlots_();
  undianUpdateStatusText_();
  undianInitCanvas_();
  undianDrawWheel_();
}
function undianRenderCandidateList_(){
  const ul = document.getElementById('undianCandidateList'); if(!ul) return;
  const list = window._undian.candidates;
  ul.innerHTML = list.length ? list.map(g=>`<li class="text-xs bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2 font-medium">${escapeHtml(g)}</li>`).join('') : `<li class="text-xs text-zinc-400 px-1 py-2">Semua Gugus sudah mendapat Slot.</li>`;
}
function undianRenderSlots_(){
  const box = document.getElementById('undianSlotContainer'); if(!box) return;
  const { teamsWithSlot, nextTeam } = undianComputeState_();
  box.innerHTML = teamsWithSlot.map(t=>`<div class="undian-slot-item ${t.gugus?'filled':''} ${(!t.gugus && nextTeam && nextTeam.id===t.id)?'next':''}"><span>SLOT ${t.slotKey}</span><span>${t.gugus?escapeHtml(t.gugus):'\u2014'}</span></div>`).join('') || `<div class="text-xs text-zinc-400">Belum ada Team dengan Slot. Tambahkan Team terlebih dahulu.</div>`;
}
function undianUpdateStatusText_(){
  const el = document.getElementById('undianStatusText'); if(!el) return;
  const { candidates, nextTeam } = undianComputeState_();
  const btn = document.getElementById('undianSpinBtn');
  if(!nextTeam){
    el.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-500 mr-1"></i> Semua Slot sudah terisi.';
    if(btn) btn.disabled = true;
  }else if(!candidates.length){
    el.innerHTML = `Menunggu Slot <b>${nextTeam.slotKey}</b> \u2014 tambahkan Gugus di Pengaturan terlebih dahulu.`;
    if(btn) btn.disabled = true;
  }else{
    el.innerHTML = `Putar untuk menentukan Gugus di <b>SLOT ${nextTeam.slotKey}</b> (${candidates.length} Gugus tersisa)`;
    if(btn) btn.disabled = false;
  }
}
function undianInitCanvas_(){
  const canvas = document.getElementById('undianWheel');
  if(!canvas) return;
  window._undian.canvas = canvas;
  window._undian.ctx = canvas.getContext('2d');
  if(!window._undian.audioCtx){
    try{ window._undian.audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ /* abaikan, tetap bisa dipakai tanpa suara klik */ }
  }
}
function undianPlayClick_(){
  const actx = window._undian.audioCtx; if(!actx) return;
  try{
    if(actx.state==='suspended') actx.resume();
    const osc = actx.createOscillator(), gain = actx.createGain();
    osc.type='triangle'; osc.frequency.setValueAtTime(300, actx.currentTime); osc.frequency.exponentialRampToValueAtTime(100, actx.currentTime+0.04);
    gain.gain.setValueAtTime(0.3, actx.currentTime); gain.gain.linearRampToValueAtTime(0.01, actx.currentTime+0.04);
    osc.connect(gain); gain.connect(actx.destination); osc.start(); osc.stop(actx.currentTime+0.04);
  }catch(e){ /* abaikan */ }
}
function undianSpeak_(text){
  try{
    if(!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang='id-ID'; u.rate=0.95; u.pitch=1.0;
    window.speechSynthesis.speak(u);
  }catch(e){ /* abaikan */ }
}
const UNDIAN_COLORS = ['#E1122F','#2563EB','#059669','#D97706','#7C3AED','#0891B2','#DB2777','#475569'];
function undianDrawWheel_(){
  const { ctx, canvas } = window._undian; if(!ctx||!canvas) return;
  const list = window._undian.candidates;
  const center = canvas.width/2;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!list.length){
    ctx.fillStyle='#E4E4E7'; ctx.beginPath(); ctx.arc(center,center,center-8,0,2*Math.PI); ctx.fill();
    return;
  }
  const anglePer = (2*Math.PI)/list.length;
  list.forEach((g,i)=>{
    const angle = window._undian.angle + i*anglePer;
    ctx.beginPath(); ctx.moveTo(center,center); ctx.arc(center,center,center-8,angle,angle+anglePer); ctx.closePath();
    ctx.fillStyle = UNDIAN_COLORS[i%UNDIAN_COLORS.length]; ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle='#fff'; ctx.stroke();
    ctx.save(); ctx.translate(center,center); ctx.rotate(angle+anglePer/2); ctx.textAlign='right'; ctx.fillStyle='#fff'; ctx.font='bold 13px sans-serif';
    ctx.fillText(g.length>16?g.slice(0,15)+'\u2026':g, center-16, 4); ctx.restore();
  });
  ctx.beginPath(); ctx.arc(center,center,40,0,2*Math.PI); ctx.fillStyle='rgba(0,0,0,.15)'; ctx.fill();
}
function undianSpin_(){
  const st = window._undian;
  if(st.spinning) return;
  const { candidates, nextTeam } = undianComputeState_();
  if(!nextTeam){ Swal.fire({icon:'info', title:'Semua Slot sudah terisi', confirmButtonColor:'#2563EB'}); return; }
  if(!candidates.length){ Swal.fire({icon:'warning', title:'Gugus sudah habis', text:'Tambahkan Gugus lagi di Pengaturan untuk mengisi slot yang tersisa.', confirmButtonColor:'#2563EB'}); return; }
  st.candidates = candidates;
  st.spinning = true;
  const btn = document.getElementById('undianSpinBtn'); if(btn) btn.disabled = true;
  const n = st.candidates.length;
  const anglePer = (2*Math.PI)/n;
  const extraRounds = Math.floor(Math.random()*3)+10;
  const randomTarget = Math.random()*360;
  const totalDeg = (extraRounds*360)+randomTarget;
  const duration = 7000;
  const start = performance.now();
  const startAngle = st.angle;
  let lastSeg = -1;
  function ease(t){ return 1-Math.pow(1-t,4); }
  function step(time){
    if(!document.getElementById('undianWheel')){ st.spinning=false; return; } /* halaman sudah ditinggalkan */
    const elapsed = time-start;
    const progress = Math.min(elapsed/duration,1);
    st.angle = startAngle + (totalDeg*Math.PI/180)*ease(progress);
    undianDrawWheel_();
    let norm = (1.5*Math.PI - (st.angle % (2*Math.PI))) % (2*Math.PI);
    if(norm<0) norm += 2*Math.PI;
    const seg = Math.floor(norm/anglePer);
    if(seg!==lastSeg){ undianPlayClick_(); lastSeg=seg; }
    if(progress<1) requestAnimationFrame(step);
    else undianShowWinner_(seg, nextTeam);
  }
  requestAnimationFrame(step);
}
function undianShowWinner_(winningIndex, nextTeam){
  const st = window._undian;
  st.pendingIdx = winningIndex;
  const gugus = st.candidates[winningIndex];
  undianSpeak_(`Slot ${nextTeam.slotKey} diisi oleh Gugus ${gugus}`);
  const titleEl = document.getElementById('undianSlotTitleText');
  const nameEl = document.getElementById('undianWinnerNameText');
  const modal = document.getElementById('undianWinnerModal');
  if(titleEl) titleEl.textContent = `HASIL UNTUK SLOT ${nextTeam.slotKey}:`;
  if(nameEl) nameEl.textContent = gugus;
  if(modal) modal.style.display = 'block';
  /* PERBAIKAN: dulu hasil undian baru benar-benar disimpan (assignGugusToTeam)
     saat admin klik "LANJUTKAN" -- kalau admin belum sempat klik (mis. layar
     ter-refresh, tidak sengaja pindah menu, atau lupa), maka hasil yang sudah
     dibacakan hilang begitu saja dan Gugus tsb harus diputar ulang dari awal.
     Sekarang begitu roda BERHENTI dan nama Gugus sudah terpilih/dibacakan,
     hasilnya LANGSUNG disimpan otomatis ke slot Team (tidak menunggu klik
     apa pun) -- tombol "LANJUTKAN" sekarang hanya berfungsi menutup modal &
     me-refresh tampilan roda untuk lanjut ke Slot berikutnya, datanya sendiri
     sudah pasti aman tersimpan sejak nama Gugus muncul di layar. */
  if(nextTeam && gugus) assignGugusToTeam(nextTeam.id, gugus);
}
function undianContinue_(){
  const st = window._undian;
  if(st.pendingIdx===-1) return;
  if('speechSynthesis' in window) window.speechSynthesis.cancel();
  st.pendingIdx = -1;
  st.spinning = false;
  const modal = document.getElementById('undianWinnerModal'); if(modal) modal.style.display='none';
  /* Hasil undian sudah otomatis tersimpan sejak undianShowWinner_ (lihat
     catatan di atas) -- di sini cukup tutup modal & render ulang halaman
     Undian untuk lanjut ke Slot/putaran berikutnya. */
  if(!document.getElementById('undianWheel')) return; /* sudah pindah halaman */
  renderUndian();
}
function undianReset_(){
  const { teamsWithSlot } = undianComputeState_();
  const filled = teamsWithSlot.filter(t=>t.gugus);
  if(!filled.length) return;
  Swal.fire({icon:'warning', title:'Undi ulang semua Slot?', text:'Semua hasil undian yang sudah ada akan dikosongkan (Team & peserta yang tertaut akan ikut terlepas dari Slot-nya). Tindakan ini tidak bisa dibatalkan.', showCancelButton:true, confirmButtonColor:'#E1122F', cancelButtonColor:'#94A3B8', confirmButtonText:'Ya, Undi Ulang'}).then(r=>{
    if(!r.isConfirmed) return;
    filled.forEach(t=>assignGugusToTeam(t.id, ''));
    addLog('Undian','Mereset seluruh hasil undian Gugus per Slot');
    renderUndian();
  });
}
function renderTeam(){
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Team','Kelola 8 tim peserta turnamen \u2014 pilih Gugus di tiap slot untuk mengganti nama Team secara otomatis', isAdmin()?`<button onclick="formTeam()" class="btn-primary"><i class="fa-solid fa-plus"></i> Tambah Team</button>`:'')}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      ${DB.teams.map(t=>{
        const pemainTeam = DB.peserta.filter(p=>p.teamId===t.id);
        const kategoriList = KATEGORI.filter(k=>DB.settings.kategoriAktif.includes(k.id));
        return `
        <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-4 shadow-softer border border-zinc-100 dark:border-zinc-800">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            ${t.slotKey?`<span class="badge bg-zinc-800 text-white shrink-0" title="Slot tetap \u2014 tidak berubah walau nama Team diganti">SLOT ${t.slotKey}</span>`:''}
            <span class="font-display font-bold text-sm truncate">${escapeHtml(t.nama)}</span>
          </div>
          <div class="mb-2">${statusPendaftaranBadge(t.statusPendaftaran)}</div>
          ${isAdmin()?`<select onchange="assignGugusToTeam('${t.id}', this.value)" class="w-full text-[11px] border border-zinc-200 dark:border-zinc-700 rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-800 outline-none mb-3" title="Pilih Gugus untuk slot ${escapeHtml(teamSlotName(t))}">
              <option value="">\u2014 Pilih Gugus \u2014</option>
              ${DB.gugus.map(g=>`<option value="${escapeHtml(g)}" ${t.gugus===g?'selected':''}>${escapeHtml(g)}</option>`).join('')}
            </select>`:`<div class="text-[11px] text-zinc-400 mb-3">${escapeHtml(t.gugus||'-')}</div>`}
          <div class="flex items-center gap-3 mb-3">
            <div class="w-12 h-12 rounded-xl flex items-center justify-center text-white font-display font-bold overflow-hidden shrink-0" style="background:${t.warna}">${t.logo?`<img src="${t.logo}" class="w-full h-full object-contain">`:(t.slotKey||(t.slotLabel||t.nama).slice(-1))}</div>
            <div><div class="text-[11px] text-zinc-400">${t.poin} poin</div></div>
          </div>
          <div class="text-xs text-zinc-500 space-y-1 mb-3">
            <div><i class="fa-solid fa-user-check w-4 text-zinc-400"></i> Koordinator: <span class="font-medium text-zinc-700 dark:text-zinc-200">${escapeHtml(t.koordinator)||'Belum ada pendaftaran'}</span></div>
            <div class="pt-1 border-t border-zinc-50 dark:border-zinc-800 space-y-1">
              ${kategoriList.map(k=>{
                const pemain = pemainTeam.filter(p=>p.kategori.includes(k.id));
                if(!pemain.length) return '';
                return `<div><span class="text-[10px] text-zinc-400">${escapeHtml(k.nama)}:</span> <span class="font-medium text-zinc-700 dark:text-zinc-200">${pemain.map(p=>escapeHtml(p.nama)).join(', ')}</span></div>`;
              }).join('') || '<div class="text-zinc-300 text-[11px]">Belum ada pemain</div>'}
            </div>
            <div class="pt-1"><i class="fa-solid fa-users w-4 text-zinc-400"></i> ${t.pemainCount||pemainTeam.length} pemain otomatis</div>
          </div>
          ${isAdmin()?`<div class="flex gap-2"><button onclick="formTeam('${t.id}')" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-pen"></i> Ubah</button><button onclick="deleteRow('teams','${t.id}')" class="btn-ghost text-xs text-red-500 justify-center"><i class="fa-solid fa-trash"></i></button></div>`:''}
        </div>`;
      }).join('')}
    </div>`;
}
function formTeam(id){
  const data = id ? DB.teams.find(x=>x.id===id) : {id:'', nama:'', logo:'', koordinator:'', warna:JERSEY_COLORS[DB.teams.length%JERSEY_COLORS.length], poin:0};
  openModal(`<div class="p-6">
    <div class="flex items-center justify-between mb-4"><h3 class="font-display font-bold text-lg">${id?'Ubah':'Tambah'} Team</h3><button onclick="closeModal()" class="text-zinc-400"><i class="fa-solid fa-xmark"></i></button></div>
    <form onsubmit="return saveTeam(event,'${id||''}')" class="space-y-3 text-sm">
      <div><label class="lbl">Nama Team</label><input class="inp" id="t_nama" value="${escapeHtml(data.nama)}" required></div>
      ${id?`<p class="text-[11px] text-zinc-400 -mt-2">Nama otomatis mengikuti Gugus yang dipilih di kartu Team. Ubah manual di sini akan tertimpa jika Gugus diganti lagi.</p>`:''}
      <p class="text-[11px] text-zinc-400">Nama koordinator dan susunan pemain mengikuti otomatis dari data pendaftaran Gugus \u2014 tidak diisi manual di sini.</p>
      <div><label class="lbl">Warna Jersey</label><input type="color" id="t_warna" value="${data.warna}" class="w-16 h-10 rounded-lg border border-zinc-200 dark:border-zinc-700"></div>
      <div>
        <label class="lbl">Logo Team</label>
        <input type="file" id="t_logoInput" accept="image/*" class="hidden" onchange="previewTeamLogo(this)">
        <div onclick="document.getElementById('t_logoInput').click()" class="flex items-center gap-3 border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-3 cursor-pointer">
          <img id="t_logoPreview" src="${data.logo||''}" class="w-10 h-10 rounded-lg object-contain bg-zinc-50 dark:bg-zinc-800 ${data.logo?'':'hidden'}">
          <span class="text-xs text-zinc-400"><i class="fa-solid fa-upload"></i> Klik untuk unggah logo</span>
        </div>
      </div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn-ghost">Batal</button><button class="btn-primary"><i class="fa-solid fa-floppy-disk"></i> Simpan</button></div>
    </form></div>`);
  window._teamLogo = data.logo || '';
}
function previewTeamLogo(input){
  const file = input.files[0]; if(!file) return;
  resizeImageFile(file, 300, 0.9, 'image/png').then(url=>{ window._teamLogo=url; const img=document.getElementById('t_logoPreview'); img.src=url; img.classList.remove('hidden'); });
}
function saveTeam(e, id){
  e.preventDefault();
  const idx = DB.teams.findIndex(x=>x.id===id);
  const existing = idx>=0 ? DB.teams[idx] : {};
  const nama = document.getElementById('t_nama').value.trim();
  const rec = { ...existing,
    id: id||uid('team'),
    nama,
    slotLabel: existing.slotLabel || nama,
    koordinator: existing.koordinator || '',
    warna: document.getElementById('t_warna').value,
    logo: window._teamLogo||'',
    poin: existing.poin || 0,
    gugus: existing.gugus || '',
    statusPendaftaran: existing.statusPendaftaran || ''
  };
  if(idx>=0) DB.teams[idx]=rec; else DB.teams.push(rec);
  saveDB(); addLog('Team', (idx>=0?'Mengubah':'Menambahkan')+' team '+rec.nama);
  syncToGoogleSheet('TEAM', idx>=0?'update':'create', rec);
  closeModal(); renderTeam();
  return false;
}
function statusPendaftaranBadge(status){
  if(status==='Terverifikasi') return `<span class="badge bg-emerald-100 text-emerald-700">Terverifikasi</span>`;
  if(status==='Perlu Perbaikan') return `<span class="badge bg-red-100 text-red-700">Perlu Perbaikan</span>`;
  if(status==='Menunggu Verifikasi') return `<span class="badge bg-amber-100 text-amber-700">Menunggu Verifikasi</span>`;
  return `<span class="badge bg-zinc-100 text-zinc-500">Belum Ada Pendaftaran</span>`;
}
function recomputeTeamStatus(team){
  const rows = DB.peserta.filter(p=>p.teamId===team.id);
  team.pemainCount = rows.length;
  team.statusPendaftaran = !rows.length ? '' : (rows.every(x=>x.status==='Terverifikasi')?'Terverifikasi':(rows.some(x=>x.status==='Ditolak')?'Perlu Perbaikan':'Menunggu Verifikasi'));
}
/* Satu sumber kebenaran: teamId setiap peserta SELALU mengikuti peta gugus->team saat ini.
   Dipanggil setiap kali data gugus pada peserta atau team berubah (daftar baru, edit, batal, assign gugus). */
function resyncPesertaTeamLinks(){
  const gugusTeamMap = {};
  DB.teams.forEach(t=>{ if(t.gugus) gugusTeamMap[t.gugus]=t; });
  DB.peserta.forEach(p=>{
    const t = gugusTeamMap[p.gugus];
    const newTeamId = t ? t.id : null;
    if(p.teamId!==newTeamId){ p.teamId = newTeamId; syncToGoogleSheet('PESERTA','update',p); }
  });
}
/* Menyegarkan nama/koordinator/sekolah/status sebuah Team berdasarkan anggota gugus yang terhubung saat ini. */
function syncTeamMeta(team){
  if(!team) return;
  if(team.gugus){
    const anggota = DB.peserta.filter(p=>p.teamId===team.id);
    team.koordinator = (anggota.find(p=>p.koordinator)||{}).koordinator || '';
    team.sekolah = (anggota.find(p=>p.asalSekolah)||{}).asalSekolah || '';
    team.nama = `GUGUS ${team.gugus.toUpperCase()}`;
  } else {
    team.koordinator = ''; team.sekolah = ''; team.nama = teamSlotName(team);
  }
  recomputeTeamStatus(team);
}
function assignGugusToTeam(teamId, gugusName){
  const team = DB.teams.find(t=>t.id===teamId); if(!team) return;
  let other = null;
  if(gugusName){
    // Satu gugus hanya boleh menempati satu slot Team \u2014 lepaskan dari slot lain jika ada
    other = DB.teams.find(t=>t.id!==team.id && t.gugus===gugusName);
    if(other) other.gugus = '';
  }
  team.gugus = gugusName || '';
  // Kelompokkan seluruh peserta gugus terpilih (bisa lebih dari satu pendaftaran/koordinator)
  // otomatis ke slot Team ini \u2014 dan lepaskan peserta yang gugusnya sudah tidak terhubung.
  resyncPesertaTeamLinks();
  syncTeamMeta(team);
  if(other) syncTeamMeta(other);
  saveDB();
  addLog('Team', gugusName ? `${teamSlotName(team)} ditetapkan sebagai GUGUS ${gugusName.toUpperCase()}` : `Mengosongkan gugus pada ${teamSlotName(team)}`);
  syncToGoogleSheet('TEAM','update',team);
  if(other) syncToGoogleSheet('TEAM','update',other);
  /* PERBAIKAN: assignGugusToTeam() sekarang juga dipanggil dari menu Undian
     (undianContinue_/undianReset_), yang punya tampilan sendiri di
     #mainContent. Dulu baris ini SELALU memanggil renderTeam() tanpa syarat,
     jadi kalau dipanggil dari halaman Undian, layar Undian yang sedang
     dilihat admin langsung tertimpa/ganti ke halaman Team. Sekarang hanya
     me-render ulang halaman Team kalau memang halaman Team yang sedang
     aktif; halaman Undian me-render ulang dirinya sendiri secara terpisah. */
  if(!document.getElementById('undianWheel')) renderTeam();
  Swal.fire({toast:true, position:'top-end', icon:'success', title: gugusName ? `${teamSlotName(team)} \u2192 GUGUS ${gugusName.toUpperCase()}` : `${teamSlotName(team)} dikosongkan`, showConfirmButton:false, timer:1800});
}

/* ---------- PEMAIN (susunan per team per kategori) ---------- */
function renderPemain(){
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Pemain','Susunan pemain tiap tim per kategori (diisi dari data Peserta yang sudah terverifikasi &amp; ditetapkan ke tim)')}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      ${DB.teams.map(t=>`
        <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-4 shadow-softer border border-zinc-100 dark:border-zinc-800">
          <div class="flex items-center gap-2 mb-1"><div class="w-3 h-3 rounded-full" style="background:${t.warna}"></div><div class="font-display font-bold text-sm">${escapeHtml(t.nama)}</div></div>
          <div class="text-[11px] text-zinc-400 mb-3"><i class="fa-solid fa-user-check w-4 text-zinc-400"></i> Koordinator: <span class="font-medium text-zinc-600 dark:text-zinc-300">${escapeHtml(t.koordinator)||'Belum ada pendaftaran'}</span></div>
          ${KATEGORI.filter(k=>DB.settings.kategoriAktif.includes(k.id)).map(k=>{
            const pemain = DB.peserta.filter(p=>p.teamId===t.id && p.kategori.includes(k.id));
            return `<div class="flex items-center justify-between text-xs py-1.5 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
              <span class="text-zinc-400">${k.nama} <span class="text-[10px]">(${pemain.length}/${k.jumlahPemain})</span></span>
              <span class="font-medium text-right">${pemain.map(p=>`${escapeHtml(p.nama)} <span class="text-[10px] ${p.status==='Terverifikasi'?'text-emerald-600':'text-amber-600'}">(${p.status})</span>`).join(', ')||'<span class="text-zinc-300">Belum diisi</span>'}</span>
            </div>`;
          }).join('')}
        </div>`).join('')}
    </div>`;
}

/* ---------- JADWAL ---------- */
function renderJadwal(){
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('JADWAL '+turnamenPlainText().toUpperCase(),'Jadwal pertandingan seluruh ronde', `${isAdmin()?`<button onclick="toggleTampilanNamaPemainJadwal()" id="btnToggleNamaPemain" class="btn-ghost no-print" title="Saat nonaktif, kolom Kategori menampilkan garis titik-titik (belum diisi) sebagai pengganti nama pemain">
        <i class="fa-solid fa-${DB.settings.tampilkanNamaPemainJadwal!==false?'eye':'eye-slash'}"></i> Nama Pemain: ${DB.settings.tampilkanNamaPemainJadwal!==false?'Aktif':'Nonaktif'}
      </button>`:''}${isAdmin()?`<button onclick="toggleJadwalOtoCard()" id="btnToggleJadwalOto" class="btn-ghost no-print"><i class="fa-solid fa-sliders"></i> Pengaturan Jadwal Pertandingan</button>`:''}<button onclick="printJadwal()" class="btn-ghost no-print"><i class="fa-solid fa-print"></i> Cetak</button>${isAdmin()?`<button onclick="jadwalForm()" class="btn-primary no-print"><i class="fa-solid fa-pen"></i> Atur Jadwal Manual</button>`:''}`)}
    ${isAdmin()?`<div id="jadwalOtoCardWrap" class="hidden">${renderJadwalOtoCardHTML()}</div>`:''}
    <div id="jdwTableWrap" class="bg-white dark:bg-zinc-900 rounded-xl2 shadow-softer border border-zinc-100 dark:border-zinc-800 overflow-x-auto"><table class="w-full text-sm" style="border-collapse:collapse;table-layout:fixed" id="jdwTable"></table></div>`;
  renderJadwalTable();
  if(isAdmin()){ renderJadwalOtoFields(); }
}
/* Aktifkan/Nonaktifkan tampilan nama pemain di kolom "Kategori" pada tabel
   Jadwal (baik di layar maupun saat dicetak). AKTIF -> tampilkan nama
   pemain sebenarnya (Nama A vs Nama B). NONAKTIF -> nama pemain disamarkan
   memakai garis titik-titik (................. vs .................)
   sehingga jadwal bisa dicetak/dibagikan lebih awal tanpa membocorkan
   susunan pemain, lalu diisi manual oleh wasit/panitia saat pertandingan
   berlangsung. Pengaturan ini tersimpan di DB.settings sehingga berlaku
   untuk semua yang membuka jadwal (bukan hanya di perangkat admin). */
function toggleTampilanNamaPemainJadwal(){
  if(!isAdmin()) return;
  DB.settings.tampilkanNamaPemainJadwal = !(DB.settings.tampilkanNamaPemainJadwal!==false);
  addLog('Jadwal', `Nama pemain di kolom Kategori jadwal di-${DB.settings.tampilkanNamaPemainJadwal?'AKTIFKAN':'NONAKTIFKAN'}`);
  saveDB();
  renderJadwal();
}
/* Toggle kartu "Pengaturan Jadwal Pertandingan": sekali klik tombol -> tampil,
   klik lagi -> sembunyi lagi (toggle show/hide, bukan selalu tampil). */
function toggleJadwalOtoCard(){
  const wrap = document.getElementById('jadwalOtoCardWrap');
  const btn = document.getElementById('btnToggleJadwalOto');
  if(!wrap) return;
  const nowHidden = wrap.classList.toggle('hidden');
  if(btn) btn.classList.toggle('btn-primary', !nowHidden);
  if(!nowHidden) renderJadwalOtoFields();
}
/* Nomor urut partai (pertandingan) mengikuti urutan tetap di bagan:
   Partai ke 1\u20134 = Perempat Final, Partai ke 5\u20136 = Semi Final, Partai ke 7 = Final. */
function partaiKe(l){
  const order = (DB.baganMeta&&DB.baganMeta.order)||[];
  const idx = order.indexOf(l.id);
  return idx>=0 ? idx+1 : null;
}
function rondeRank(r){ return r==='Perempat Final'?0 : r==='Semi Final'?1 : r==='Final'?2 : 3; }
/* Kunci urutan jadwal. Utamakan posisi di DB.baganMeta.order (dibuat saat
   Generate Bagan: Partai 1=A vs B, 2=C vs D, 3=E vs F, 4=G vs H, lalu Semi
   Final, lalu Final). Jika data lama/tidak lengkap sehingga laga tsb tidak
   tercatat di baganMeta.order (mis. bagan dibuat versi aplikasi sebelumnya),
   urutan tetap dipaksa mengikuti Ronde lalu Slot Team (A/B, C/D, E/F, G/H)
   supaya lawan TIDAK PERNAH tampil acak walau data lama. */
function jadwalSortKey(l){
  const order = (DB.baganMeta&&DB.baganMeta.order)||[];
  const idx = order.indexOf(l.id);
  if(idx>=0) return idx;
  const slotA = teamSlotKode(l.teamA), slotB = teamSlotKode(l.teamB);
  const slots = [slotA, slotB].filter(Boolean).sort();
  const minSlot = slots[0] || 'Z';
  return 1000 + rondeRank(l.ronde)*100 + minSlot.charCodeAt(0);
}
/* Skor 1 kategori (Main) di kolom Jadwal. Default tampilkan simbol "-" jika
   kategori tsb belum diisi skornya sama sekali; begitu skor mulai diisi
   (mode SET 1/2/3 ataupun SCORE 42), tampilkan hasilnya secara ringkas. */
function mainSkorText(l, p){
  if(!p) return '<span class="text-zinc-300">-</span>';
  const mode = l.scoreMode || 'SET_ALL';
  const colA = teamColor(l.teamA), colB = teamColor(l.teamB);
  if(mode==='SCORE_42'){
    const a=(p.score42&&p.score42[0])||0, b=(p.score42&&p.score42[1])||0;
    if(a===0 && b===0) return '<span class="text-zinc-300">-</span>';
    return `<span class="font-score font-bold" style="color:${colA}">${a}</span><span class="text-zinc-400 mx-1">-</span><span class="font-score font-bold" style="color:${colB}">${b}</span>`;
  }
  const sets = p.sets || [[0,0],[0,0],[0,0]];
  let winsA=0, winsB=0, played=false;
  sets.forEach(s=>{ if(s[0]>0||s[1]>0){ played=true; if(s[0]>s[1]) winsA++; else if(s[1]>s[0]) winsB++; } });
  if(!played) return '<span class="text-zinc-300">-</span>';
  return `<span class="font-score font-bold" style="color:${colA}">${winsA}</span><span class="text-zinc-400 mx-1">-</span><span class="font-score font-bold" style="color:${colB}">${winsB}</span>`;
}
/* Skor RINCI per-set (bukan cuma jumlah set menang) -- khusus dipakai di kartu
   Jadwal Pertandingan halaman awal (lihat renderPublicJadwalRingkas_) supaya
   peserta bisa melihat skor pemain apa adanya per set, mis. "21-15 &middot; 18-21
   &middot; 21-19", bukan cuma ringkasan "2-1". Untuk mode SCORE 42 (skor langsung
   tanpa per-set) cukup ditampilkan total akhirnya saja. */
function mainSkorDetailText_(l, p){
  if(!p) return '';
  const mode = l.scoreMode || 'SET_ALL';
  if(mode==='SCORE_42'){
    const a=(p.score42&&p.score42[0])||0, b=(p.score42&&p.score42[1])||0;
    if(a===0 && b===0) return '';
    return `${a}&#8211;${b}`;
  }
  const sets = p.sets || [[0,0],[0,0],[0,0]];
  const played = sets.filter(s=> s[0]>0 || s[1]>0);
  if(!played.length) return '';
  return played.map(s=> `${s[0]}&#8211;${s[1]}`).join(' &middot; ');
}
function renderJadwalTable(){
  document.getElementById('jdwTable').innerHTML = buildJadwalTableHTML();
}
/* Menghasilkan HTML lengkap tabel Jadwal (thead+tbody) sebagai STRING murni,
   dipakai baik untuk tabel di layar (#jdwTable) MAUPUN untuk lembar cetak
   (#jadwalPrintSheet). Dibuat sebagai fungsi generator terpisah \u2014 bukan
   meng-clone elemen #jdwTable yang sudah ada di layar \u2014 supaya hasil cetak
   selalu pasti terisi (tidak pernah blank/kosong) walau tabel di layar
   sedang di-scale, ter-scroll, atau DOM-nya belum sempat diukur. */
function buildJadwalTableHTML(forPrint, publicMode){
  /* Urutan jadwal WAJIB mengikuti urutan Partai di bagan (Partai 1 = Slot A vs B,
     Partai 2 = C vs D, Partai 3 = E vs F, Partai 4 = G vs H, lalu Semi Final,
     lalu Final) \u2014 bukan diurutkan berdasarkan tanggal/jam, supaya lawan tidak
     pernah tampil acak walau jadwal per laga diisi tidak berurutan atau data
     baganMeta.order tidak lengkap (lihat jadwalSortKey). */
  const rows = DB.laga.slice().sort((a,b)=> jadwalSortKey(a) - jadwalSortKey(b));
  /* Satu PARTAI (laga = pertandingan antar 2 tim) selalu terdiri dari 5 MAIN
     (Main 1..Main 5 = 5 kategori aktif). Kolom yang nilainya sama untuk
     seluruh Main dalam 1 Partai (Ronde+Partai ke, Tanggal, Pertandingan,
     Status, Aksi) HANYA ditulis 1x memakai rowspan \u2014 tidak diulang di tiap
     baris Main, sesuai permintaan. Setelah Main terakhir tiap Partai, baris
     Partai berikutnya diberi garis horizontal tebal (kelas jdw-partai-start)
     sebagai pemisah antar Partai. Kolom Jam menampilkan rentang mulai\u2013selesai
     tiap Main, dihitung otomatis dari jam mulai Partai + durasi per
     pertandingan (l.durasiMenit) + jeda antar pertandingan (l.jedaMenit). */
  const td = 'px-4 py-2.5 text-xs border border-zinc-200 dark:border-zinc-700 align-middle';
  /* Kolom Aksi (tombol edit) HANYA relevan di layar untuk admin \u2014 saat cetak
     kolom ini selalu disembunyikan lewat class no-print. Jika tetap ikut
     dihitung dalam lebar 8 kolom (isAdmin()) maka pada hasil cetak lebar
     totalnya jadi kurang dari 100% (karena 1 kolom hilang dari layout),
     menyisakan celah kosong memanjang di sebelah kanan kolom Skor. Maka
     saat forPrint=true, kolom Aksi dianggap TIDAK ADA sama sekali (baik di
     header, body, maupun perhitungan lebar) supaya sisa 7 kolom melebar
     rapi mengisi 100% lebar kertas. */
  const showAksi = isAdmin() && !forPrint;
  const colCount = showAksi?8:7;
  let lastDate = undefined;
  let mainKeCounter = 0;
  const bodyRows = [];
  /* publicMode=true dipakai HANYA untuk tampilan Jadwal di halaman awal
     (lihat renderPublicJadwalRingkas_) -- SETIAP Partai diberi warna berbeda
     (dari palet UNDIAN_COLORS yang sama dipakai menu Undian, biar konsisten)
     supaya peserta mudah membedakan kelompok pertandingan sekilas mata.
     TIDAK berlaku saat forPrint (download PDF) -- hasil unduhan tetap
     hitam-putih standar, identik dengan yang admin unduh di menu Jadwal. */
  const partaiColorMap = {};
  let colorCounter = 0;
  rows.forEach(l=>{
    if(l.tanggal !== lastDate){
      lastDate = l.tanggal;
      bodyRows.push(`<tr class="bg-zinc-50 dark:bg-zinc-800/60"><td colspan="${colCount}" class="px-4 py-2 text-xs font-bold text-primary border border-zinc-200 dark:border-zinc-700"><i class="fa-solid fa-calendar-day mr-1"></i> ${l.tanggal?fmtDateFull(l.tanggal):'Tanggal Belum Diatur'}</td></tr>`);
    }
    const pk = partaiKe(l);
    const items = (l.partai&&l.partai.length) ? l.partai : [null];
    const n = items.length;
    const spacing = Math.max(1, parseInt(l.durasiKategori,10)||15);
    const durasiMain = Math.max(1, parseInt(l.durasiMenit,10) || spacing);
    if(publicMode && !partaiColorMap[l.id]){ partaiColorMap[l.id] = UNDIAN_COLORS[colorCounter % UNDIAN_COLORS.length]; colorCounter++; }
    const pColor = publicMode ? partaiColorMap[l.id] : null;
    items.forEach((p,idx)=>{
      mainKeCounter++;
      const isFirst = idx===0;
      const mulai = l.jam ? addMinutesToTime(l.jam, idx*spacing) : null;
      const jamCell = mulai ? `${mulai}\u2013${addMinutesToTime(mulai,durasiMain)}` : '-';
      /* Sedang berlangsung SEKARANG = per kategori (Main), bukan per Partai
         \u2014 supaya di antara 5 Main dalam 1 Partai, hanya baris kategori yang
         jamnya benar-benar sedang berjalan yang menyala merah. */
      const isLiveMain = publicMode && mulai && l.tanggal===todayISO() && l.status!=='Selesai' && nowTime()>=mulai && nowTime()<=addMinutesToTime(mulai,durasiMain);
      const rowClasses = [isFirst?'jdw-partai-start':'', isLiveMain?'jdw-live-pulse':''].filter(Boolean).join(' ');
      const rowStyle = pColor ? ` style="background:${pColor}1A"` : '';
      const trCls = rowClasses ? ` class="${rowClasses}"` : '';
      /* Nama pemain di kolom Kategori bisa disamarkan (garis titik-titik)
         lewat tombol "Nama Pemain: Aktif/Nonaktif" di atas tabel (lihat
         toggleTampilanNamaPemainJadwal). Default AKTIF (tampil apa adanya). */
      const namaPemainAktif = DB.settings.tampilkanNamaPemainJadwal !== false;
      const DOT_PLACEHOLDER = '<span class="text-zinc-400">.....................</span>';
      const namaA = p ? (namaPemainAktif ? (pemainMainNama(l,p,'A') || '<span class="text-zinc-300">Belum diisi</span>') : DOT_PLACEHOLDER) : '';
      const namaB = p ? (namaPemainAktif ? (pemainMainNama(l,p,'B') || '<span class="text-zinc-300">Belum diisi</span>') : DOT_PLACEHOLDER) : '';
      const lockedIcon = (p && namaPemainAktif && (p.namaPemainA!=null || p.namaPemainB!=null)) ? ' <i class="fa-solid fa-lock" style="font-size:8px;opacity:.55" title="Pemain terkunci (partai sudah selesai)"></i>' : '';
      /* Nama pemain ditampilkan sebelah KIRI (mengikuti Team A/sisi kiri kolom
         Pertandingan) dan sebelah KANAN (mengikuti Team B/sisi kanan) --
         bukan lagi digabung rata tengah "namaA vs namaB" -- supaya sekilas
         mata langsung terlihat pemain mana milik team yang mana, konsisten
         dengan urutan Team A vs Team B di kolom Pertandingan sebelahnya. */
      const kategoriCell = p
        ? `<div class="text-[10px] font-bold uppercase tracking-wide text-primary mb-0.5">${escapeHtml(kategoriNama(p.kategoriId))}${isLiveMain?' <span class=\"text-red-600\">\u25CF LIVE</span>':''}</div><div class="text-[11px] font-medium text-zinc-700 dark:text-zinc-200 leading-snug flex items-center justify-between gap-1"><span class="text-left flex-1">${namaA}</span><span class="text-zinc-400 font-normal shrink-0">vs</span><span class="text-right flex-1">${namaB}${lockedIcon}</span></div>`
        : '<span class="text-zinc-300 text-[11px]">-</span>';
      /* Skor per kategori (Main) \u2014 bukan skor akhir Partai. Tampilkan "-" jika
         kategori tersebut belum diisi skornya sama sekali, dan tampilkan
         skornya begitu sudah diisi (mendukung mode SET 1/2/3 maupun SCORE 42). */
      const skorMainCell = `<td class="${td} text-center whitespace-nowrap">${mainSkorText(l,p)}</td>`;
      /* Kolom yang tetap sama untuk 1 Partai hanya dirender pada baris Main
         pertama (idx 0) memakai rowspan, sisanya tidak dirender. Kolom
         Tanggal dipecah 2 baris (nama Hari di atas, tanggal lengkap di
         bawah) supaya tidak melebar & menutup/mendesak kolom lain. Kolom
         Pertandingan hanya menampilkan nama Team saja (tanpa kode Slot
         A/B/dst) supaya lebih ringkas dan tidak menghalangi. */
      const rondeCell = isFirst ? `<td class="${td} jdw-rowspan text-center" rowspan="${n}"${rowStyle}>${l.ronde}${pk?`<div class="text-zinc-400 mt-0.5">Partai ke ${pk}</div>`:''}</td>` : '';
      const hariNama = l.tanggal ? fmtDateFull(l.tanggal).split(',')[0] : '';
      const tglNama = l.tanggal ? fmtDateFull(l.tanggal).split(', ')[1] : '-';
      const tglCell = isFirst ? `<td class="${td} jdw-rowspan text-center" rowspan="${n}"${rowStyle}>${l.tanggal?`<div class="font-semibold">${hariNama}</div><div class="text-zinc-500 dark:text-zinc-400 mt-0.5">${tglNama}</div>`:'-'}</td>` : '';
      const pertandinganCell = isFirst ? `<td class="${td} jdw-rowspan text-center" rowspan="${n}"${rowStyle} style="font-size:14px;font-weight:800">${escapeHtml(teamNama(l.teamA))} <span class="text-zinc-400 font-normal" style="font-size:11px;font-weight:600">vs</span> ${escapeHtml(teamNama(l.teamB))}</td>` : '';
      const aksiCell = showAksi ? (isFirst ? `<td class="${td} jdw-rowspan text-right no-print" rowspan="${n}"><button onclick="jadwalForm('${l.id}')" class="icon-btn text-primary"><i class="fa-solid fa-pen"></i></button></td>` : '') : '';
      bodyRows.push(`<tr${trCls}${rowStyle}>
        ${rondeCell}
        ${tglCell}
        <td class="${td} whitespace-nowrap text-center">${jamCell}</td>
        <td class="${td} font-semibold text-primary text-center">Main ke ${mainKeCounter}</td>
        ${pertandinganCell}
        <td class="${td} text-center">${kategoriCell}</td>
        ${skorMainCell}
        ${aksiCell}
      </tr>`);
    });
  });
  /* Lebar tiap kolom ditetapkan presisi (persen tetap, table-layout:fixed)
     supaya rapi & konsisten \u2014 bukan lagi mengikuti panjang konten secara
     otomatis (yang sebelumnya membuat kolom Kategori melebar berlebihan ke
     kanan sementara kolom Pertandingan malah sempit). Kolom Pertandingan
     diperlebar & tulisannya diperbesar (text-sm font-semibold), kolom
     Kategori dipaskan sedikit lebih ramping. Total tiap set wajib 100%. */
  /* Saat showAksi=false (baik untuk user non-admin MAUPUN saat forPrint,
     lihat penjelasan di atas), total lebar 7 kolom yang tersisa WAJIB
     tetap 100% \u2014 bukan 94% seperti sebelumnya \u2014 supaya tidak ada celah
     kosong di sisi kanan kolom Skor saat dicetak. */
  const W = showAksi
    ? { ronde:10, tanggal:9, jam:8, mainke:7, pertandingan:29, kategori:22, skor:9, aksi:6 }
    : { ronde:10, tanggal:9, jam:8, mainke:7, pertandingan:33, kategori:24, skor:9 };
  return `
    <thead class="bg-primary-light dark:bg-primary/10 text-xs text-primary"><tr>
      <th class="px-4 py-3 text-center border border-zinc-200 dark:border-zinc-700" style="width:${W.ronde}%">Ronde</th>
      <th class="px-4 py-3 text-center border border-zinc-200 dark:border-zinc-700" style="width:${W.tanggal}%">Tanggal</th>
      <th class="px-4 py-3 text-center border border-zinc-200 dark:border-zinc-700" style="width:${W.jam}%">Jam</th>
      <th class="px-4 py-3 text-center border border-zinc-200 dark:border-zinc-700" style="width:${W.mainke}%">Main Ke</th>
      <th class="px-4 py-3 text-center border border-zinc-200 dark:border-zinc-700" style="width:${W.pertandingan}%">Pertandingan</th>
      <th class="px-4 py-3 text-center border border-zinc-200 dark:border-zinc-700" style="width:${W.kategori}%">Kategori</th>
      <th class="px-4 py-3 text-center border border-zinc-200 dark:border-zinc-700" style="width:${W.skor}%">Skor</th>
      ${showAksi?`<th class="px-4 py-3 text-right no-print border border-zinc-200 dark:border-zinc-700" style="width:${W.aksi}%">Aksi</th>`:''}
    </tr></thead>
    <tbody>${bodyRows.join('') || `<tr><td colspan="${colCount}">${emptyState('fa-calendar-days','Belum ada jadwal','Generate bagan terlebih dahulu di menu Bagan untuk membuat jadwal otomatis.')}</td></tr>`}</tbody>`;
}
function jadwalForm(id){
  const l = DB.laga.find(x=>x.id===id); if(!l){ Swal.fire({icon:'info', title:'Pilih laga dari menu Bagan', text:'Buat/generate bagan terlebih dahulu, lalu atur jadwal tiap laga dari sana.', confirmButtonColor:'#2563EB'}); return; }
  const n = (l.partai&&l.partai.length)||5;
  openModal(`<div class="p-6">
    <h3 class="font-display font-bold text-lg mb-3">Atur Jadwal \u2014 ${l.ronde}</h3>
    <div class="text-xs text-zinc-400 mb-3">${escapeHtml(teamNama(l.teamA))} vs ${escapeHtml(teamNama(l.teamB))} \u00B7 ${n} Main (Main 1\u2013${n})</div>
    <div class="text-[11px] text-zinc-400 mb-3">Partai ke ${partaiKe(l)||'-'} \u00B7 nomor urut ini otomatis mengikuti urutan bagan.</div>
    <form onsubmit="return saveJadwal(event,'${id}')" class="grid grid-cols-2 gap-3 text-sm">
      <div><label class="lbl">Tanggal</label><input type="date" class="inp" id="j_tgl" value="${l.tanggal||todayISO()}"></div>
      <div><label class="lbl">Jam Mulai (Main 1)</label><input type="time" class="inp" id="j_jam" value="${l.jam||nowTime()}"></div>
      <div><label class="lbl">Lapangan</label><input type="number" min="1" max="${DB.settings.jumlahLapangan}" class="inp" id="j_lap" value="${l.lapangan||1}"></div>
      <div></div>
      <div><label class="lbl">Durasi per Pertandingan (menit)</label><input type="number" min="1" step="5" class="inp" id="j_dur" value="${l.durasiMenit||15}"></div>
      <div><label class="lbl">Jeda Antar Pertandingan (menit)</label><input type="number" min="0" step="5" class="inp" id="j_jeda" value="${l.jedaMenit||0}"></div>
      <div class="col-span-2 text-[11px] text-zinc-400">Main 2, 3, dst dihitung otomatis berurutan dari Jam Mulai + Durasi + Jeda.</div>
      <div class="col-span-2 flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn-ghost">Batal</button><button class="btn-primary"><i class="fa-solid fa-floppy-disk"></i> Simpan</button></div>
    </form></div>`);
}
function saveJadwal(e,id){
  e.preventDefault();
  const l = DB.laga.find(x=>x.id===id);
  l.tanggal=document.getElementById('j_tgl').value; l.jam=document.getElementById('j_jam').value;
  l.lapangan=document.getElementById('j_lap').value;
  l.durasiMenit=parseInt(document.getElementById('j_dur').value,10)||15;
  l.jedaMenit=parseInt(document.getElementById('j_jeda').value,10)||0;
  l.durasiKategori = l.durasiMenit + l.jedaMenit;
  saveDB(); addLog('Jadwal','Mengatur jadwal '+l.ronde+': '+teamNama(l.teamA)+' vs '+teamNama(l.teamB));
  syncToGoogleSheet('JADWAL','update',l);
  closeModal(); renderJadwalTable();
}
/* Cetak Jadwal \u2014 memakai lembar cetak terpisah #jadwalPrintSheet (pola yang
   sama seperti cetak Bagan, lihat preparePrintBaganSheet/executePrintBagan).
   Konten dibangun ULANG langsung dari data (buildJadwalTableHTML()), bukan
   meng-clone tabel yang sedang tampil di layar, supaya hasil cetak PASTI
   terisi walau tabel di layar sedang di-scroll/di-toggle/belum ter-render
   sempurna. Diposisikan rata ATAS halaman (bukan di tengah), dan tetap
   di-auto-fit (auto-scale) supaya mengisi 1 lembar penuh tanpa terpotong. */
function preparePrintJadwalSheet(){
  let sheet = document.getElementById('jadwalPrintSheet');
  if(!sheet){ sheet = document.createElement('div'); sheet.id = 'jadwalPrintSheet'; document.body.appendChild(sheet); }
  if(!DB.laga.length){
    sheet.innerHTML = `<div style="padding:40px;text-align:center;color:#71717A;font-family:'Poppins',sans-serif">Jadwal belum tersedia. Generate bagan terlebih dahulu di menu Bagan sebelum mencetak.</div>`;
    return false;
  }
  sheet.innerHTML = `<div id="jadwalPrintInner">
    <h1 style="font-family:'Poppins',sans-serif;font-size:14px;font-weight:800;margin:0 0 2px;color:#0B0B0F">JADWAL ${escapeHtml(turnamenPlainText().toUpperCase())}</h1>
    <p style="font-family:'Poppins',sans-serif;font-size:9px;margin:0 0 6px;color:#71717A">Jadwal pertandingan seluruh ronde</p>
    <table style="table-layout:fixed">${buildJadwalTableHTML(true)}</table>
  </div>`;
  return true;
}
function printJadwal(){
  openPaperSizeModal({
    title:'Cetak Jadwal Pertandingan',
    desc:'Pilih ukuran kertas dan orientasi. Tabel jadwal otomatis di-auto-fit (auto-scale) supaya mengisi 1 lembar penuh dari atas \u2014 rapi, proporsional, tidak terpotong, dan tanpa halaman kosong tambahan.',
    onPick:(size,orient)=> executePrintJadwal(size, orient)
  });
}
function executePrintJadwal(size, orient){
  const ok = preparePrintJadwalSheet();
  if(!ok){ Swal.fire({icon:'info', title:'Jadwal belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu di menu Bagan sebelum mencetak jadwal.', confirmButtonColor:'#2563EB'}); return; }
  let {w,h} = PAPER_SIZES_MM[size] || PAPER_SIZES_MM.A4;
  if(orient==='landscape'){ const t=w; w=h; h=t; }
  const marginMm = 8;
  // @page tanpa margin negosiasi browser \u2014 margin kita kontrol penuh lewat
  // padding di #jadwalPrintSheet, supaya presisi & konsisten di semua printer/PDF.
  const pageStyle = document.createElement('style');
  pageStyle.id = 'jadwalPageSizeStyle';
  pageStyle.textContent = `@page{ size:${w}mm ${h}mm; margin:0; }`;
  document.head.appendChild(pageStyle);

  const sheet = document.getElementById('jadwalPrintSheet');
  const inner = document.getElementById('jadwalPrintInner');
  // Reset sebelum ukur ulang, supaya hasil pengukuran alami (belum di-scale)
  inner.style.transform = 'none';
  inner.style.width = '100%';
  sheet.style.cssText = '';

  document.body.classList.add('printing-jadwal');

  const doMeasureAndPrint = ()=>{
    const pxPerMm = 96/25.4;
    const pageWpx = w*pxPerMm, pageHpx = h*pxPerMm;
    const marginPx = marginMm*pxPerMm;
    sheet.style.boxSizing = 'border-box';
    sheet.style.width = pageWpx+'px';
    sheet.style.height = pageHpx+'px';
    sheet.style.padding = marginPx+'px';
    sheet.style.setProperty('display', 'flex', 'important');
    sheet.style.alignItems = 'flex-start';    // rata ATAS (bukan di tengah)
    sheet.style.justifyContent = 'center';
    sheet.style.overflow = 'hidden';
    sheet.style.margin = '0';

    const rect = inner.getBoundingClientRect();
    const availW = pageWpx - marginPx*2;
    const availH = pageHpx - marginPx*2;
    const scale = Math.min(availW/rect.width, availH/rect.height, 1.6);
    inner.style.width = availW+'px';
    inner.style.transformOrigin = 'top center';
    inner.style.transform = `scale(${scale})`;
    inner.style.flex = 'none';

    const cleanup = ()=>{
      document.body.classList.remove('printing-jadwal');
      inner.style.transform=''; inner.style.width=''; inner.style.transformOrigin=''; inner.style.flex='';
      sheet.style.cssText = '';
      const st = document.getElementById('jadwalPageSizeStyle'); if(st) st.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(()=>window.print(), 80);
  };
  // Dua frame agar layout benar-benar sudah ter-render (display:block baru diaktifkan lewat class printing-jadwal)
  requestAnimationFrame(()=>requestAnimationFrame(doMeasureAndPrint));
}

/* ---------- BAGAN ---------- */
function renderBaganPage(){
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Bagan Pertandingan','Sistem gugur 8 tim \u2014 Perempat Final, Semi Final, Final. Slot A vs B, C vs D, E vs F, G vs H otomatis mengikuti data Team.', `<button onclick="printBagan()" class="btn-ghost"><i class="fa-solid fa-print"></i> Cetak / Unduh PDF</button>${isAdmin()?`<button onclick="confirmGenerateBagan()" class="btn-primary"><i class="fa-solid fa-diagram-project"></i> ${DB.baganMeta.generated?'Buat Ulang Bagan':'Generate Bagan'}</button>`:''}`)}
    <div class="rounded-xl2 overflow-hidden no-print"><div id="baganBox"></div></div>`;
  drawBagan('baganBox', true);
}
function confirmGenerateBagan(){
  if(DB.teams.length<8){ Swal.fire({icon:'warning', title:'Team belum lengkap', text:'Bagan 8 tim memerlukan minimal 8 tim terdaftar (Slot A\u2013H) di menu Team.', confirmButtonColor:'#2563EB'}); return; }
  Swal.fire({icon:'warning', title: DB.baganMeta.generated?'Buat ulang bagan?':'Generate bagan sekarang?', text: DB.baganMeta.generated?'Seluruh data laga & skor yang sudah ada akan direset. Bagan akan dibentuk ulang mengikuti Slot A\u2013H dari menu Team.':'Perempat Final akan dibentuk otomatis: Slot A vs B, C vs D, E vs F, G vs H sesuai data di menu Team.', showCancelButton:true, confirmButtonColor:'#2563EB', confirmButtonText:'Ya, lanjutkan'}).then(r=>{
    if(r.isConfirmed) generateBagan();
  });
}
function slotTeam(letter){ return DB.teams.find(t=>t.slotKey===letter) || null; }
function generateBagan(){
  // Bagan mengikuti pemetaan Slot Team yang sudah diatur admin di menu Team:
  // Perempat Final tetap: Slot A vs B, Slot C vs D, Slot E vs F, Slot G vs H (bukan undian acak).
  const A=slotTeam('A'), B=slotTeam('B'), C=slotTeam('C'), D=slotTeam('D'), E=slotTeam('E'), F=slotTeam('F'), G=slotTeam('G'), H=slotTeam('H');
  const kategoriAktif = KATEGORI.filter(k=>DB.settings.kategoriAktif.includes(k.id));
  function mkPartai(){ return kategoriAktif.map(k=>({kategoriId:k.id, sets:[[0,0],[0,0],[0,0]], score42:[0,0], winner:null})); }
  function mkLaga(ronde, teamA, teamB){ return {id:uid('laga'), ronde, teamA:teamA||null, teamB:teamB||null, tanggal:todayISO(), jam:nowTime(), lapangan:1, durasiMenit:15, jedaMenit:0, durasiKategori:15, status: (teamA&&teamB)?'Belum Main':'Belum Main', partai: mkPartai(), skorTeamA:0, skorTeamB:0, pemenangTeam:null}; }
  const qf = [
    mkLaga('Perempat Final', A&&A.id, B&&B.id),
    mkLaga('Perempat Final', C&&C.id, D&&D.id),
    mkLaga('Perempat Final', E&&E.id, F&&F.id),
    mkLaga('Perempat Final', G&&G.id, H&&H.id)
  ];
  const sf = [ mkLaga('Semi Final', null, null), mkLaga('Semi Final', null, null) ];
  const fin = mkLaga('Final', null, null);
  DB.laga = [...qf, ...sf, fin];
  DB.baganMeta = { generated:true, order:[qf[0].id, qf[1].id, qf[2].id, qf[3].id, sf[0].id, sf[1].id, fin.id] };
  DB.juaraTeamId = null;
  DB.teams.forEach(t=>t.poin=0);
  window._currentLagaId = null; window._scoreUIMode = null; _activeSetMap = {};
  saveDB(); addLog('Bagan','Bagan turnamen dibuat mengikuti pemetaan Slot A\u2013H dari menu Team (Slot A vs B, C vs D, E vs F, G vs H)');
  navigate('bagan');
  Swal.fire({toast:true, position:'top-end', icon:'success', title:'Bagan berhasil dibuat', showConfirmButton:false, timer:1800});
}
function advanceBagan(laga){
  const order = DB.baganMeta.order; const pos = order.indexOf(laga.id);
  if(pos<0 || pos>=6) { if(pos===6){ DB.juaraTeamId = laga.pemenangTeam; addLog('Bagan', 'Juara turnamen: '+teamNama(laga.pemenangTeam)); } saveDB(); return; }
  if(pos<4){
    const pairIndex = Math.floor(pos/2); const sfId = order[4+pairIndex]; const sfLaga = DB.laga.find(x=>x.id===sfId);
    if(pos%2===0) sfLaga.teamA = laga.pemenangTeam; else sfLaga.teamB = laga.pemenangTeam;
  } else if(pos<6){
    const finId = order[6]; const finLaga = DB.laga.find(x=>x.id===finId);
    if(pos===4) finLaga.teamA = laga.pemenangTeam; else finLaga.teamB = laga.pemenangTeam;
  }
  saveDB();
}
/* ---------- Bagan: knockout bracket (professional layout) ---------- */
function baganRoundsData(){
  const order = DB.baganMeta.order;
  return {
    qf: [order[0],order[1],order[2],order[3]].map(id=>DB.laga.find(x=>x.id===id)),
    sf: [order[4],order[5]].map(id=>DB.laga.find(x=>x.id===id)),
    fin: DB.laga.find(x=>x.id===order[6])
  };
}
function rbMatchCard(l, matchNoLabel, showActions){
  if(!l){
    return `<div class="match-card no-click">
      <div class="match-id">-</div>
      <div class="match-body">
        <div class="team-item"><div class="team-name">\u{1F6E1}\uFE0F TBD</div><div class="score-badge">-</div></div>
        <div class="team-item"><div class="team-name">\u{1F6E1}\uFE0F TBD</div><div class="score-badge">-</div></div>
        <div class="match-meta"><span class="tag-pending">BELUM MAIN</span><span class="meta-date">Menunggu ronde sebelumnya</span></div>
      </div>
    </div>`;
  }
  const winA = !!l.pemenangTeam && l.pemenangTeam===l.teamA;
  const winB = !!l.pemenangTeam && l.pemenangTeam===l.teamB;
  const played = l.status!=='Belum Main';
  const clickable = showActions && l.teamA && l.teamB;
  const isActive = showActions && window._scoreUIMode==='bagan' && window._currentLagaId===l.id;
  const statusTag = l.status==='Selesai'
    ? '<span class="tag-completed">\u2713 SELESAI</span>'
    : l.status==='Sedang Main'
      ? '<span class="tag-live">\u25CF LIVE</span>'
      : '<span class="tag-pending">BELUM MAIN</span>';
  const meta = l.tanggal && l.jam ? `${fmtDate(l.tanggal)} \u2022 ${l.jam}` : 'Jadwal belum diatur';
  const teamRow = (id, score, isWinner) => {
    const nm = id ? teamNama(id) : 'TBD';
    const col = id ? teamColor(id) : '#94A3B8';
    return `<div class="team-item" style="background:linear-gradient(90deg,color-mix(in srgb, ${col} 18%, transparent),transparent);border-left:3px solid ${col};padding-left:6px;">
      <div class="team-name ${isWinner?'highlight':''}">\u{1F6E1}\uFE0F ${escapeHtml(nm)}${isWinner?' \u{1F451}':''}</div>
      <div class="score-badge ${isWinner?'win':''}">${played&&id?score:'-'}</div>
    </div>`;
  };
  return `<div class="match-card ${clickable?'':'no-click'}" style="${isActive?'outline:2px solid #F5B301;outline-offset:2px;':''}" onclick="${clickable?`selectBaganMatch('${l.id}')`:''}">
    <div class="match-id">${matchNoLabel}</div>
    <div class="match-body">
      ${teamRow(l.teamA,l.skorTeamA,winA)}
      ${teamRow(l.teamB,l.skorTeamB,winB)}
      <div class="match-meta">${statusTag}<span class="meta-date">${escapeHtml(meta)}</span></div>
    </div>
  </div>`;
}
function rbColumnHTML(matches, label, cls, idPrefix, showActions){
  const single = matches.length===1;
  return `<div class="bracket-col">
    <div class="col-title ${cls}">${label}</div>
    <div class="match-list" ${single?'style="justify-content:center;"':''}>
      ${matches.map((l,i)=>rbMatchCard(l, single?'FINAL':idPrefix+(i+1), showActions)).join('')}
    </div>
  </div>`;
}
/* Bagan sebagai satu alur (flow) dengan garis penghubung emas menyala antar ronde,
   posisi tiap kartu & konektor dihitung persentase agar selalu presisi bertemu. */
function rbSlotTop(n,i){ return ((i+0.5)/n*100); }
function rbConnectorHTML(topA, topB){
  const top = Math.min(topA, topB), h = Math.abs(topB-topA);
  return `<div class="brk-connector" style="top:${top}%;height:${h}%">
    <span class="brk-bracket"></span>
    <span class="brk-line"></span>
  </div>`;
}
function rbChampionCard(){
  const has = !!DB.juaraTeamId;
  const nm = has ? teamNama(DB.juaraTeamId) : 'Menunggu Final';
  const col = has ? teamColor(DB.juaraTeamId) : '#94A3B8';
  return `<div class="champion-card ${has?'':'is-waiting'}">
    <div class="champion-card-trophy">\u{1F3C6}</div>
    <div class="champion-card-label">JUARA TURNAMEN</div>
    <div class="champion-card-name" style="${has?`color:${col};`:''}">${has?'\u{1F6E1}\uFE0F ':''}${escapeHtml(nm)}</div>
  </div>`;
}
function rbFlowHTML(qf, sf, fin, showActions){
  const qfTop = [0,1,2,3].map(i=>rbSlotTop(4,i));
  const sfTop = [0,1].map(i=>rbSlotTop(2,i));
  const finTop = rbSlotTop(1,0);
  const qfCol = `<div class="brk-round">
    <div class="brk-round-title brk-qf">PEREMPAT FINAL</div>
    <div class="brk-round-body">
      ${qf.map((l,i)=>`<div class="brk-slot" style="top:${qfTop[i]}%">${rbMatchCard(l,'QF'+(i+1),showActions)}</div>`).join('')}
    </div>
  </div>`;
  const conn1 = `<div class="brk-connect">${rbConnectorHTML(qfTop[0],qfTop[1])}${rbConnectorHTML(qfTop[2],qfTop[3])}</div>`;
  const sfCol = `<div class="brk-round">
    <div class="brk-round-title brk-sf">SEMI FINAL</div>
    <div class="brk-round-body">
      ${sf.map((l,i)=>`<div class="brk-slot" style="top:${sfTop[i]}%">${rbMatchCard(l,'SF'+(i+1),showActions)}</div>`).join('')}
    </div>
  </div>`;
  const conn2 = `<div class="brk-connect">${rbConnectorHTML(sfTop[0],sfTop[1])}</div>`;
  const finCol = `<div class="brk-round">
    <div class="brk-round-title brk-final">FINAL</div>
    <div class="brk-round-body">
      <div class="brk-slot" style="top:${finTop}%">${rbMatchCard(fin,'FINAL',showActions)}</div>
    </div>
  </div>`;
  const conn3 = `<div class="brk-connect brk-connect-final">
    <span class="brk-line" style="top:${finTop}%"></span>
    <i class="fa-solid fa-chevron-right brk-arrow" style="top:${finTop}%"></i>
  </div>`;
  /* Kolom JUARA \u2014 round terakhir dalam alur yang sama, lebar & posisi vertikalnya
     memakai sistem slot presisi yang sama persis dengan QF/SF/Final di atas. */
  const champCol = `<div class="brk-round">
    <div class="brk-round-title brk-champion">\u{1F451} JUARA</div>
    <div class="brk-round-body">
      <div class="brk-slot" style="top:${finTop}%">${rbChampionCard()}</div>
    </div>
  </div>`;
  return `<div class="brk-flow">${qfCol}${conn1}${sfCol}${conn2}${finCol}${conn3}${champCol}</div>`;
}
function rbHeaderHTML(){
  const s=DB.settings;
  const tglRange=s.tanggalMulai?`${fmtDate(s.tanggalMulai)}${s.tanggalSelesai&&s.tanggalSelesai!==s.tanggalMulai?' \u2013 '+fmtDate(s.tanggalSelesai):''}`:'';
  return `<div class="inner-header">
    <div class="header-brand">
      <div class="shuttle-badge">${s.logoUrl?`<img src="${s.logoUrl}">`:'\u{1F3F8}'}</div>
      <div class="brand-text">
        <h2>BAGAN PERTANDINGAN</h2>
        <p>KNOCKOUT 8 TIM \u2022 SISTEM GUGUR</p>
      </div>
    </div>
    <div class="tournament-title">
      <h3>${s.namaTurnamen||'BADMINTIME Tournament'}</h3>
      <p>\u{1F4CD} ${escapeHtml([s.lokasi,tglRange].filter(Boolean).join(' \u2022 ')||'-')}</p>
    </div>
  </div>`;
}
function rbBottomInfoHTML(){
  return `<div class="bottom-info-grid">
    <div class="info-card">
      <h4>\u{1F4A1} CARA PENGGUNAAN</h4>
      <div class="instructions-content">
        <div style="background:#1e293b;padding:6px;border-radius:6px;">\u{1F446}</div>
        <div>Klik pada kartu pertandingan untuk membuka form input skor. Pemenang otomatis akan maju ke ronde berikutnya.</div>
      </div>
    </div>
    <div class="info-card">
      <h4>KETERANGAN</h4>
      <div class="legend-list">
        <div class="legend-item"><span class="dot" style="background:#64748b;"></span> Belum Main</div>
        <div class="legend-item"><span class="dot" style="background:#ef4444;"></span> Live / Sedang Berlangsung</div>
        <div class="legend-item"><span class="dot" style="background:#16a34a;"></span> Selesai</div>
        <div class="legend-item"><span class="dot" style="background:#f59e0b;"></span> Pemenang</div>
      </div>
    </div>
  </div>`;
}
function rbBracketBodyHTML(showActions, panelHTML){
  const {qf,sf,fin}=baganRoundsData();
  return `<div class="main-layout">
    <div class="bracket-wrapper">
      ${rbFlowHTML(qf,sf,fin,showActions)}
    </div>
  </div>
  ${panelHTML||''}
  ${rbBottomInfoHTML()}`;
}
function drawBagan(containerId, showActions){
  const el = document.getElementById(containerId);
  if(!DB.baganMeta.generated || !DB.laga.length){ el.innerHTML = emptyState('fa-diagram-project','Bagan belum dibuat','Admin perlu men-generate bagan terlebih dahulu dari menu Bagan. Slot A\u2013H akan otomatis diambil dari data Team.'); return; }
  let panelHTML = '';
  if(showActions && window._currentLagaId){
    const activeLaga = DB.laga.find(x=>x.id===window._currentLagaId);
    if(activeLaga && activeLaga.teamA && activeLaga.teamB){
      window._scoreUIMode = 'bagan';
      panelHTML = `<div id="baganScorePanel" class="score-modal" style="margin:18px auto 0;">${scorePartaiFormHTML(activeLaga,'bagan')}</div>`;
    }
  }
  el.innerHTML = `<div class="bagan-redesign">${rbHeaderHTML()}${rbBracketBodyHTML(showActions, panelHTML)}</div>`;
}

/* ---------- Bagan: cetak / unduh PDF presisi A4 ---------- */
function preparePrintBaganSheet(){
  let sheet = document.getElementById('baganPrintSheet');
  if(!sheet){
    sheet = document.createElement('div');
    sheet.id = 'baganPrintSheet';
    document.body.appendChild(sheet);
  }
  if(!DB.baganMeta.generated || !DB.laga.length){
    sheet.innerHTML = `<div style="padding:40px;text-align:center;color:#71717A;font-family:'Poppins',sans-serif">Bagan belum dibuat. Generate bagan terlebih dahulu sebelum mencetak.</div>`;
    return false;
  }
  sheet.innerHTML = `<div id="baganPrintInner" class="bagan-redesign">
    ${rbHeaderHTML()}
    ${rbBracketBodyHTML(false)}
    <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:9px;color:#71717A;border-top:1px dashed #334155;padding-top:8px;">
      <span>Dicetak: ${new Date().toLocaleString('id-ID')}</span><span>BADMINTIME Tournament Management System</span>
    </div>
  </div>`;
  return true;
}
/* Ukuran kertas cetak (mm) yang didukung */
const PAPER_SIZES_MM = { A4:{w:210,h:297}, F4:{w:215,h:330} };
/* ---------- PEMILIH UKURAN KERTAS (dipakai di SEMUA fitur cetak) ----------
   Menampilkan 4 tombol pilihan langsung: A4 Portrait, A4 Landscape,
   F4 Portrait, F4 Landscape. Begitu salah satu diklik, modal tertutup dan
   opts.onPick(size, orient) langsung dipanggil \u2014 tidak perlu tombol
   "Konfirmasi" terpisah supaya alurnya cepat (1 klik = langsung proses). */
function openPaperSizeModal(opts){
  opts = opts || {};
  const cardStyle = 'border:2px solid #E4E4E7;border-radius:14px;padding:16px 10px;background:#fff;cursor:pointer;text-align:center;transition:border-color .15s,background .15s;';
  const sizes = [
    {size:'A4', orient:'portrait',  label:'A4 Portrait',  sub:'210 \u00D7 297 mm', w:32, h:44, color:'#2563EB'},
    {size:'A4', orient:'landscape', label:'A4 Landscape', sub:'297 \u00D7 210 mm', w:44, h:32, color:'#2563EB'},
    {size:'F4', orient:'portrait',  label:'F4 Portrait',  sub:'215 \u00D7 330 mm', w:32, h:48, color:'#D97706'},
    {size:'F4', orient:'landscape', label:'F4 Landscape', sub:'330 \u00D7 215 mm', w:48, h:32, color:'#D97706'},
  ];
  /* PENTING: jangan panggil opts.onPick() (yang ujungnya memanggil
     window.print()) langsung di dalam click handler tombol. Saat Swal.close()
     dipanggil, modal masih dalam proses animasi/pembongkaran dari DOM
     (belum benar-benar hilang). Jika window.print() terlanjur dipicu di
     titik ini, browser bisa "memotret" halaman saat overlay modal masih
     ada di atasnya, sehingga hasil cetak tampak kosong/blank. Solusinya:
     hanya SIMPAN pilihan pengguna di variabel `picked`, lalu jalankan
     opts.onPick() di dalam .then() milik Swal.fire() \u2014 .then() ini baru
     terpenuhi SETELAH modal benar-benar tertutup & terhapus total dari
     DOM, sehingga aman dipakai untuk mencetak. */
  let picked = null;
  Swal.fire({
    title: opts.title || 'Pilih Ukuran Kertas',
    html: `<div style="text-align:left">
        <p style="font-size:12px;color:#71717A;margin:0 0 14px">${opts.desc || 'Pilih ukuran kertas dan orientasi cetak \u2014 hasil akan otomatis disesuaikan (auto-fit) supaya mengisi 1 lembar penuh, rapi, dan tidak terpotong.'}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${sizes.map((s,i)=>`
            <button type="button" class="ps-opt-btn" data-i="${i}" style="${cardStyle}">
              <div style="width:${s.w}px;height:${s.h}px;border:2px solid ${s.color};border-radius:3px;margin:0 auto 8px;background:#F8FAFC"></div>
              <div style="font-weight:700;font-size:13px;color:#0B0B0F">${s.label}</div>
              <div style="font-size:10px;color:#A1A1AA;margin-top:2px">${s.sub}</div>
            </button>`).join('')}
        </div>
      </div>`,
    width: 400,
    showConfirmButton: false,
    showCancelButton: true,
    cancelButtonText: 'Batal',
    didOpen: (el)=>{
      el.querySelectorAll('.ps-opt-btn').forEach(btn=>{
        btn.addEventListener('mouseenter', ()=>{ btn.style.borderColor='#2563EB'; btn.style.background='#F5F8FF'; });
        btn.addEventListener('mouseleave', ()=>{ btn.style.borderColor='#E4E4E7'; btn.style.background='#fff'; });
        btn.addEventListener('click', ()=>{
          picked = sizes[parseInt(btn.getAttribute('data-i'),10)];
          Swal.close();
        });
      });
    }
  }).then(()=>{
    // Titik ini baru tercapai setelah modal 100% tertutup & dibongkar dari DOM.
    if(picked && typeof opts.onPick === 'function') opts.onPick(picked.size, picked.orient);
  });
}
/* Cetak generik (Bukti Pendaftaran, Hasil & Klasemen, Laporan, dsb) \u2014 dokumen
   yang belum punya mekanisme auto-fit khusus seperti Bagan/Jadwal. Tetap
   memberi pilihan ukuran kertas A4/F4 Portrait/Landscape sebelum mencetak,
   supaya konsisten 1 lembar penuh & rapi di semua fitur cetak pada web ini. */
function smartPrint(title){
  openPaperSizeModal({
    title: title || 'Pengaturan Cetak',
    onPick:(size,orient)=>{
      let {w,h} = PAPER_SIZES_MM[size] || PAPER_SIZES_MM.A4;
      if(orient==='landscape'){ const t=w; w=h; h=t; }
      let st = document.getElementById('smartPrintPageSizeStyle');
      if(!st){ st=document.createElement('style'); st.id='smartPrintPageSizeStyle'; document.head.appendChild(st); }
      st.textContent = `@page{ size:${w}mm ${h}mm; margin:8mm; }`;
      const cleanup = ()=>{ const e=document.getElementById('smartPrintPageSizeStyle'); if(e) e.remove(); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      setTimeout(()=>window.print(), 60);
    }
  });
}
function printBagan(){
  if(!DB.baganMeta.generated || !DB.laga.length){
    Swal.fire({icon:'info', title:'Bagan belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu.', confirmButtonColor:'#2563EB'});
    return;
  }
  openPaperSizeModal({
    title:'Cetak Bagan Pertandingan',
    desc:'Pilih ukuran kertas dan orientasi (landscape disarankan untuk bagan). Bagan otomatis di-auto-fit supaya mengisi 1 lembar penuh dan tidak terpotong.',
    onPick:(size,orient)=> executePrintBagan(size, orient)
  });
}
function executePrintBagan(size, orient){
  const ok = preparePrintBaganSheet();
  if(!ok){ Swal.fire({icon:'info', title:'Bagan belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu.', confirmButtonColor:'#2563EB'}); return; }
  let {w,h} = PAPER_SIZES_MM[size] || PAPER_SIZES_MM.A4;
  if(orient==='landscape'){ const t=w; w=h; h=t; }
  const marginMm = 8;
  // @page tanpa margin bawaan browser \u2014 margin kiri/kanan/atas/bawah kita kontrol
  // sendiri lewat padding di #baganPrintSheet, supaya hasilnya presisi & simetris
  // di semua printer/PDF, tidak tergantung interpretasi margin bawaan browser.
  const pageStyle = document.createElement('style');
  pageStyle.id = 'baganPageSizeStyle';
  pageStyle.textContent = `@page{ size:${w}mm ${h}mm; margin:0; }`;
  document.head.appendChild(pageStyle);

  const sheet = document.getElementById('baganPrintSheet');
  const inner = document.getElementById('baganPrintInner');
  // Reset sebelum ukur ulang, supaya hasil pengukuran alami (belum di-scale)
  inner.style.transform = 'none';
  inner.style.width = 'max-content';
  sheet.style.cssText = '';

  document.body.classList.add('printing-bagan');

  const doMeasureAndPrint = ()=>{
    const pxPerMm = 96/25.4;
    const pageWpx = w*pxPerMm, pageHpx = h*pxPerMm;
    const marginPx = marginMm*pxPerMm;
    // Sheet dipatok tepat ukuran kertas (W\u00D7H mm), padding = margin di 4 sisi,
    // konten di-scale lalu diletakkan RATA ATAS (top) & center secara horizontal.
    sheet.style.boxSizing = 'border-box';
    sheet.style.width = pageWpx+'px';
    sheet.style.height = pageHpx+'px';
    sheet.style.padding = marginPx+'px';
    sheet.style.setProperty('display', 'flex', 'important');
    sheet.style.alignItems = 'flex-start';    // rata ATAS (bukan di tengah)
    sheet.style.justifyContent = 'center';
    sheet.style.overflow = 'hidden';
    sheet.style.margin = '0';

    const rect = inner.getBoundingClientRect();
    const availW = pageWpx - marginPx*2;
    const availH = pageHpx - marginPx*2;
    const scale = Math.min(availW/rect.width, availH/rect.height, 1);
    inner.style.transformOrigin = 'top center';
    inner.style.transform = `scale(${scale})`;
    inner.style.flex = 'none';

    const cleanup = ()=>{
      document.body.classList.remove('printing-bagan');
      inner.style.transform=''; inner.style.width=''; inner.style.transformOrigin=''; inner.style.flex='';
      sheet.style.cssText = '';
      const st = document.getElementById('baganPageSizeStyle'); if(st) st.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(()=>window.print(), 80);
  };
  // Dua frame agar layout benar-benar sudah ter-render (display:block baru diaktifkan lewat class printing-bagan)
  requestAnimationFrame(()=>requestAnimationFrame(doMeasureAndPrint));
}

/* ---------- UNDUH LANGSUNG (bukan dialog print) untuk Bagan & Jadwal di HALAMAN AWAL ----------
   Tombol "Download" di panel publik (Bagan Pertandingan & Jadwal Pertandingan) pada halaman
   awal SENGAJA dibuat BEDA dari printBagan()/printJadwal() (dipakai admin) yang memanggil
   window.print(). Di HP, window.print() cuma membuka dialog print/share bawaan browser --
   peserta harus tahu harus pilih "Simpan sebagai PDF" sendiri dulu, dan di sebagian browser
   HP malah tidak ada opsi unduh langsung sama sekali. Di sini file PDF langsung DIBUAT lewat
   html2canvas (memotret sheet cetak sebagai gambar) + jsPDF, lalu diunduh otomatis ke
   perangkat lewat doc.save() -- sama seperti alur downloadBuktiPdf(). Sheet cetak yang dipakai
   TETAP #baganPrintSheet / #jadwalPrintSheet yang sama persis dengan punya admin, jadi hasil
   unduhan peserta 100% identik isinya dengan yang diunduh admin. */
function elementToPdfAndSave_(sheet, wMm, hMm, filename){
  return html2canvas(sheet, {scale:2, useCORS:true, backgroundColor:'#ffffff'}).then(canvas=>{
    const { jsPDF } = window.jspdf;
    const orientation = wMm >= hMm ? 'landscape' : 'portrait';
    const doc = new jsPDF({unit:'mm', format:[wMm,hMm], orientation});
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(imgData, 'JPEG', 0, 0, wMm, hMm);
    doc.save(filename);
  });
}
function downloadPublicBagan(){
  if(!DB.baganMeta.generated || !DB.laga.length){
    Swal.fire({icon:'info', title:'Bagan belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu.', confirmButtonColor:'#2563EB'});
    return;
  }
  // Failsafe: kalau library html2canvas gagal dimuat (mis. CDN diblokir jaringan),
  // jangan sampai tombol Download malah tidak berfungsi sama sekali -- jatuhkan ke
  // alur cetak lama (printBagan) yang tidak butuh html2canvas.
  if(typeof html2canvas === 'undefined'){ printBagan(); return; }
  openPaperSizeModal({
    title:'Unduh Bagan Pertandingan',
    desc:'Pilih ukuran kertas dan orientasi (landscape disarankan untuk bagan). File PDF akan otomatis terunduh ke perangkat Anda.',
    onPick:(size,orient)=> executeDownloadPublicBagan(size, orient)
  });
}
function executeDownloadPublicBagan(size, orient){
  const ok = preparePrintBaganSheet();
  if(!ok){ Swal.fire({icon:'info', title:'Bagan belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu.', confirmButtonColor:'#2563EB'}); return; }
  let {w,h} = PAPER_SIZES_MM[size] || PAPER_SIZES_MM.A4;
  if(orient==='landscape'){ const t=w; w=h; h=t; }
  const marginMm = 8;
  const sheet = document.getElementById('baganPrintSheet');
  const inner = document.getElementById('baganPrintInner');
  inner.style.transform = 'none';
  inner.style.width = 'max-content';
  sheet.style.cssText = '';
  document.body.classList.add('printing-bagan');
  Swal.fire({title:'Menyiapkan PDF...', html:'Mohon tunggu sebentar, file sedang dibuat.', allowOutsideClick:false, allowEscapeKey:false, showConfirmButton:false, didOpen:()=>Swal.showLoading()});
  const doMeasureAndSave = ()=>{
    const pxPerMm = 96/25.4;
    const pageWpx = w*pxPerMm, pageHpx = h*pxPerMm;
    const marginPx = marginMm*pxPerMm;
    sheet.style.boxSizing = 'border-box';
    sheet.style.width = pageWpx+'px';
    sheet.style.height = pageHpx+'px';
    sheet.style.padding = marginPx+'px';
    sheet.style.setProperty('display', 'flex', 'important');
    sheet.style.alignItems = 'flex-start';
    sheet.style.justifyContent = 'center';
    sheet.style.overflow = 'hidden';
    sheet.style.margin = '0';
    sheet.style.background = '#ffffff';

    const rect = inner.getBoundingClientRect();
    const availW = pageWpx - marginPx*2;
    const availH = pageHpx - marginPx*2;
    const scale = Math.min(availW/rect.width, availH/rect.height, 1);
    inner.style.transformOrigin = 'top center';
    inner.style.transform = `scale(${scale})`;
    inner.style.flex = 'none';

    const cleanup = ()=>{
      document.body.classList.remove('printing-bagan');
      inner.style.transform=''; inner.style.width=''; inner.style.transformOrigin=''; inner.style.flex='';
      sheet.style.cssText = '';
    };
    elementToPdfAndSave_(sheet, w, h, `Bagan-Pertandingan-${todayISO()}.pdf`)
      .then(()=>{ cleanup(); Swal.close(); })
      .catch(err=>{
        console.error('[downloadPublicBagan] gagal:', err);
        cleanup();
        Swal.fire({icon:'error', title:'Gagal membuat PDF', text:'Terjadi kesalahan saat membuat file. Silakan coba lagi.', confirmButtonColor:'#2563EB'});
      });
  };
  requestAnimationFrame(()=>requestAnimationFrame(doMeasureAndSave));
}
function downloadPublicJadwal(){
  if(!DB.laga.length){
    Swal.fire({icon:'info', title:'Jadwal belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu di menu Bagan sebelum mengunduh jadwal.', confirmButtonColor:'#2563EB'});
    return;
  }
  if(typeof html2canvas === 'undefined'){ printJadwal(); return; }
  openPaperSizeModal({
    title:'Unduh Jadwal Pertandingan',
    desc:'Pilih ukuran kertas dan orientasi. File PDF akan otomatis terunduh ke perangkat Anda.',
    onPick:(size,orient)=> executeDownloadPublicJadwal(size, orient)
  });
}
function executeDownloadPublicJadwal(size, orient){
  const ok = preparePrintJadwalSheet();
  if(!ok){ Swal.fire({icon:'info', title:'Jadwal belum tersedia', text:'Admin perlu men-generate bagan terlebih dahulu di menu Bagan sebelum mengunduh jadwal.', confirmButtonColor:'#2563EB'}); return; }
  let {w,h} = PAPER_SIZES_MM[size] || PAPER_SIZES_MM.A4;
  if(orient==='landscape'){ const t=w; w=h; h=t; }
  const marginMm = 8;
  const sheet = document.getElementById('jadwalPrintSheet');
  const inner = document.getElementById('jadwalPrintInner');
  inner.style.transform = 'none';
  inner.style.width = '100%';
  sheet.style.cssText = '';
  document.body.classList.add('printing-jadwal');
  Swal.fire({title:'Menyiapkan PDF...', html:'Mohon tunggu sebentar, file sedang dibuat.', allowOutsideClick:false, allowEscapeKey:false, showConfirmButton:false, didOpen:()=>Swal.showLoading()});
  const doMeasureAndSave = ()=>{
    const pxPerMm = 96/25.4;
    const pageWpx = w*pxPerMm, pageHpx = h*pxPerMm;
    const marginPx = marginMm*pxPerMm;
    sheet.style.boxSizing = 'border-box';
    sheet.style.width = pageWpx+'px';
    sheet.style.height = pageHpx+'px';
    sheet.style.padding = marginPx+'px';
    sheet.style.setProperty('display', 'flex', 'important');
    sheet.style.alignItems = 'flex-start';
    sheet.style.justifyContent = 'center';
    sheet.style.overflow = 'hidden';
    sheet.style.margin = '0';
    sheet.style.background = '#ffffff';

    const rect = inner.getBoundingClientRect();
    const availW = pageWpx - marginPx*2;
    const availH = pageHpx - marginPx*2;
    const scale = Math.min(availW/rect.width, availH/rect.height, 1.6);
    inner.style.width = availW+'px';
    inner.style.transformOrigin = 'top center';
    inner.style.transform = `scale(${scale})`;
    inner.style.flex = 'none';

    const cleanup = ()=>{
      document.body.classList.remove('printing-jadwal');
      inner.style.transform=''; inner.style.width=''; inner.style.transformOrigin=''; inner.style.flex='';
      sheet.style.cssText = '';
    };
    elementToPdfAndSave_(sheet, w, h, `Jadwal-Pertandingan-${todayISO()}.pdf`)
      .then(()=>{ cleanup(); Swal.close(); })
      .catch(err=>{
        console.error('[downloadPublicJadwal] gagal:', err);
        cleanup();
        Swal.fire({icon:'error', title:'Gagal membuat PDF', text:'Terjadi kesalahan saat membuat file. Silakan coba lagi.', confirmButtonColor:'#2563EB'});
      });
  };
  requestAnimationFrame(()=>requestAnimationFrame(doMeasureAndSave));
}

/* ---------- SKOR ---------- */
function renderSkor(){
  const active = DB.laga.filter(l=>l.teamA && l.teamB);
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Input Skor','Pilih pertandingan untuk mengisi skor per partai')}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      ${active.map(l=>`
        <div onclick="skorLaga('${l.id}')" class="cursor-pointer bg-white dark:bg-zinc-900 rounded-xl2 p-4 shadow-softer border border-zinc-100 dark:border-zinc-800 hover:border-primary/40 transition">
          <div class="flex items-center justify-between mb-2"><span class="badge bg-zinc-100 dark:bg-zinc-800 text-zinc-500">${l.ronde}</span><span class="badge ${l.status==='Selesai'?'bg-emerald-100 text-emerald-700':l.status==='Sedang Main'?'bg-amber-100 text-amber-700':'bg-zinc-100 text-zinc-500'}">${l.status}</span></div>
          <div class="grid grid-cols-2 gap-2 mt-2">
            <div class="rounded-lg p-2 team-score-a" style="--team-color:${teamColor(l.teamA)}"><div class="text-[10px] text-zinc-400">A</div><div class="font-display font-bold text-xs">${escapeHtml(teamNama(l.teamA))}</div><div class="font-score text-2xl" style="color:${teamColor(l.teamA)}">${l.skorTeamA}</div></div>
            <div class="rounded-lg p-2 team-score-b" style="--team-color:${teamColor(l.teamB)}"><div class="text-[10px] text-zinc-400">B</div><div class="font-display font-bold text-xs">${escapeHtml(teamNama(l.teamB))}</div><div class="font-score text-2xl" style="color:${teamColor(l.teamB)}">${l.skorTeamB}</div></div>
          </div>
        </div>`).join('') || `<div class="col-span-full">${emptyState('fa-table-tennis-paddle-ball','Belum ada pertandingan','Generate bagan terlebih dahulu di menu Bagan.')}</div>`}
    </div>`;
}
let _activeSetMap = {};
function firstIncompleteSetIndex(p){
  for(let si=0; si<3; si++){ if(p.sets[si][0]===0 && p.sets[si][1]===0) return si; }
  return 2;
}
function setActiveSet(partaiIdx, setIdx){
  _activeSetMap[partaiIdx] = setIdx;
  refreshScoreUI();
}
function refreshScoreUI(){
  if(window._scoreUIMode==='modal') skorLaga(window._currentLagaId);
  else if(window._scoreUIMode==='bagan') drawBagan('baganBox', true);
}
/* Nama pemain sebuah team pada kategori tertentu (untuk baris PARTAI) */
function partaiPemainNama(teamId, kategoriId){
  if(!teamId) return '';
  const list = DB.peserta.filter(p=>p.teamId===teamId && p.kategoriId===kategoriId).sort((a,b)=>(a.slot||1)-(b.slot||1));
  if(!list.length) return '';
  return list.map(x=>x.nama).join(' / ');
}
/* ---------- Nama pemain per-Main: LIVE vs TERKUNCI ----------
   Satu Team punya roster per kategori yang bisa berubah (mis. admin memperbaiki
   data pemain, atau pemain yang sama ternyata juga terdaftar di kategori lain
   seperti Ganda Campuran selain Tunggal Putra). Selama sebuah Main (partai
   per-kategori dalam satu Partai/laga) BELUM selesai, nama pemain yang
   ditampilkan selalu mengikuti data TERKINI (live) dari menu Peserta/Team --
   supaya begitu admin memperbarui pemain untuk kategori itu, Main yang belum
   dimainkan otomatis ikut ter-update.
   Begitu Main tsb SELESAI (p.winner sudah terisi, lihat lockPemainMain_ yang
   dipanggil dari updateSetScore/updateScore42), nama pemain yang sedang
   tampil saat itu di-SNAPSHOT ke p.namaPemainA/p.namaPemainB dan dianggap
   TERKUNCI -- perubahan roster setelahnya TIDAK lagi mengubah riwayat Main
   yang sudah selesai ini, walau nanti admin mengedit data Peserta. Begitu
   masuk ke Partai berikutnya (ronde selanjutnya), objek `p`-nya baru (belum
   terkunci) sehingga otomatis mengambil roster PALING BARU lagi. */
function pemainMainNama(l, p, sisi){
  if(!p) return '';
  const locked = sisi==='A' ? p.namaPemainA : p.namaPemainB;
  if(locked !== undefined && locked !== null) return locked;
  const teamId = sisi==='A' ? l.teamA : l.teamB;
  return partaiPemainNama(teamId, p.kategoriId);
}
function lockPemainMain_(l, p){
  if(p.winner){
    p.namaPemainA = partaiPemainNama(l.teamA, p.kategoriId) || '';
    p.namaPemainB = partaiPemainNama(l.teamB, p.kategoriId) || '';
  } else {
    // Belum/tidak lagi ada pemenang (mis. skor direset admin) -- lepas kunci,
    // kembali mengikuti roster terkini selama Main ini belum selesai lagi.
    p.namaPemainA = null;
    p.namaPemainB = null;
  }
}
/* Titik status per-partai: gray=belum main, orange=live/berjalan, green=selesai */
function partaiStatusDot(p, mode){
  if(p.winner) return 'green';
  const started = mode==='SCORE_42'
    ? !!(p.score42 && (p.score42[0]>0 || p.score42[1]>0))
    : (p.sets||[]).some(s=>s[0]>0||s[1]>0);
  return started ? 'orange' : 'gray';
}
function sv2RowHTML(l, p, i, mode, colA, colB){
  if(!p.sets) p.sets = [[0,0],[0,0],[0,0]];
  if(!p.score42) p.score42 = [0,0];
  const namaA = pemainMainNama(l, p, 'A');
  const namaB = pemainMainNama(l, p, 'B');
  const isLocked = p.namaPemainA!=null || p.namaPemainB!=null;
  const lockedIcon = isLocked ? ' <i class="fa-solid fa-lock" style="font-size:9px;opacity:.55" title="Pemain terkunci -- Main ini sudah selesai, nama pemain tidak lagi mengikuti perubahan roster"></i>' : '';
  const dot = partaiStatusDot(p, mode);
  const winnerLabel = p.winner ? `<div class="sv2-row-winner">&#128081; ${escapeHtml(p.winner==='A'?teamNama(l.teamA):teamNama(l.teamB))}</div>` : '';
  let inputsHTML;
  if(mode==='SCORE_42'){
    const a=(p.score42&&p.score42[0])||0, b=(p.score42&&p.score42[1])||0;
    inputsHTML = `
      <div class="sv2-team-input-group left">
        <input type="number" min="0" max="99" class="sv2-score-input sv2-score-input-42" style="border:1.5px solid ${colA}" value="${a||''}" placeholder="0" onchange="updateScore42(${i},0,this.value)" aria-label="Skor ${escapeHtml(teamNama(l.teamA))}">
      </div>
      <div class="sv2-team-input-group right">
        <input type="number" min="0" max="99" class="sv2-score-input sv2-score-input-42" style="border:1.5px solid ${colB}" value="${b||''}" placeholder="0" onchange="updateScore42(${i},1,this.value)" aria-label="Skor ${escapeHtml(teamNama(l.teamB))}">
      </div>`;
  } else {
    inputsHTML = `
      <div class="sv2-team-input-group left">
        ${[0,1,2].map(si=>`<input type="number" min="0" max="99" class="sv2-score-input" style="border:1.5px solid ${colA}" value="${p.sets[si][0]||''}" placeholder="-" onchange="updateSetScore(${i},${si},0,this.value)" aria-label="Set ${si+1} ${escapeHtml(teamNama(l.teamA))}">`).join('')}
      </div>
      <div class="sv2-team-input-group right">
        ${[0,1,2].map(si=>`<input type="number" min="0" max="99" class="sv2-score-input" style="border:1.5px solid ${colB}" value="${p.sets[si][1]||''}" placeholder="-" onchange="updateSetScore(${i},${si},1,this.value)" aria-label="Set ${si+1} ${escapeHtml(teamNama(l.teamB))}">`).join('')}
      </div>`;
  }
  return `
    <div class="sv2-match-row">
      <div class="sv2-row-label">
        <div class="sv2-row-kategori"><span class="sv2-row-status-dot ${dot}"></span>${escapeHtml(kategoriNama(p.kategoriId))}</div>
        <div class="sv2-row-pemain">
          <span style="color:${colA}">${escapeHtml(namaA||'-')}</span>
          <span style="color:#475569"> vs </span>
          <span style="color:${colB}">${escapeHtml(namaB||'-')}</span>${lockedIcon}
        </div>
        ${winnerLabel}
      </div>
      <div class="sv2-scores-wrapper">${inputsHTML}</div>
    </div>`;
}
function scorePartaiFormHTML(l, mode){
  const closeAction = mode==='modal' ? 'window._currentLagaId=null;window._scoreUIMode=null;closeModal()' : 'clearBaganSelection()';
  const saveAction = `simpanSkorLaga('${l.id}','${mode}')`;
  const colA = teamColor(l.teamA), colB = teamColor(l.teamB);
  const scoreMode = l.scoreMode || 'SET_ALL';
  return `
    <div class="sv2-header">
      <h2 class="sv2-title font-display">Input Skor Pertandingan</h2>
      <button class="sv2-close" onclick="${closeAction}" aria-label="Tutup">&times;</button>
    </div>

    <div class="sv2-mode-selector">
      <label for="sv2ScoreMode">PILIH TAMPILAN SCORE:</label>
      <select id="sv2ScoreMode" onchange="ubahModeScoreV2(this.value)">
        <option value="SET_ALL" ${scoreMode==='SET_ALL'?'selected':''}>SET 1, SET 2, SET 3</option>
        <option value="SCORE_42" ${scoreMode==='SCORE_42'?'selected':''}>SCORE 42 (Langsung)</option>
      </select>
    </div>

    <div class="sv2-teams-header">
      <div class="sv2-team-info">
        <span class="sv2-dot" style="background:${colA};color:${colA}"></span>
        <span class="sv2-team-name" title="${escapeHtml(teamNama(l.teamA))}">${escapeHtml(teamNama(l.teamA))}</span>
      </div>
      <div class="sv2-vs">VS</div>
      <div class="sv2-team-info" style="justify-content:flex-end">
        <span class="sv2-team-name" style="text-align:right" title="${escapeHtml(teamNama(l.teamB))}">${escapeHtml(teamNama(l.teamB))}</span>
        <span class="sv2-dot" style="background:${colB};color:${colB}"></span>
      </div>
    </div>

    <div class="sv2-match-body">
      <div class="sv2-total-card" style="--tc:${colA}">
        <div class="sv2-score-num font-score">${l.skorTeamA}</div>
        <div class="sv2-score-label">TOTAL</div>
      </div>

      <div class="sv2-grid-container">
        <div class="sv2-grid-header-row">
          <div class="sv2-header-partai">PARTAI</div>
          <div class="sv2-header-col" style="color:${colA}">${escapeHtml(teamNama(l.teamA))}${scoreMode==='SET_ALL'?' <span style="opacity:.6">(S1&middot;S2&middot;S3)</span>':''}</div>
          <div class="sv2-header-col" style="color:${colB}">${escapeHtml(teamNama(l.teamB))}${scoreMode==='SET_ALL'?' <span style="opacity:.6">(S1&middot;S2&middot;S3)</span>':''}</div>
        </div>
        ${l.partai.map((p,i)=>sv2RowHTML(l,p,i,scoreMode,colA,colB)).join('')}
      </div>

      <div class="sv2-total-card" style="--tc:${colB}">
        <div class="sv2-score-num font-score">${l.skorTeamB}</div>
        <div class="sv2-score-label">TOTAL</div>
      </div>
    </div>

    <div class="sv2-status-legend">
      <div class="sv2-legend-item"><span class="sv2-legend-dot gray"></span><span>Belum Main</span></div>
      <div class="sv2-legend-item"><span class="sv2-legend-dot orange"></span><span>Live</span></div>
      <div class="sv2-legend-item"><span class="sv2-legend-dot green"></span><span>Selesai</span></div>
      <div class="sv2-legend-item"><span style="color:#F59E0B">&#128081;</span><span>Pemenang</span></div>
    </div>

    <div class="sv2-action-buttons">
      <button class="sv2-btn sv2-btn-cancel" onclick="${closeAction}">Batal</button>
      <button class="sv2-btn sv2-btn-save" onclick="${saveAction}"><span>&#10003;</span> Simpan Skor</button>
    </div>`;
}
/* Tombol "Simpan Skor" \u2014 memastikan skor tersimpan ke localStorage + Google Sheet,
   lalu menampilkan notifikasi tersimpan sebelum menutup panel/modal. */
function simpanSkorLaga(id, mode){
  const l = DB.laga.find(x=>x.id===id);
  if(!l){ Swal.fire({icon:'error', title:'Pertandingan tidak ditemukan', confirmButtonColor:'#E1122F'}); return; }
  recalcLagaResult(l);
  saveDB();
  syncToGoogleSheet('SKOR','update', l);
  Swal.fire({toast:true, position:'top-end', icon:'success', title:'Skor tersimpan', showConfirmButton:false, timer:1600});
  if(mode==='modal'){
    window._currentLagaId = null; window._scoreUIMode = null; closeModal();
  } else {
    clearBaganSelection();
  }
  renderSkorIfActive();
}
function skorLaga(id){
  const l=DB.laga.find(x=>x.id===id);
  if(!l||!l.teamA||!l.teamB){
    Swal.fire({icon:'info',title:'Menunggu lawan',text:'Kedua tim belum ditentukan (menunggu hasil ronde sebelumnya).',confirmButtonColor:'#2563EB'});
    return;
  }
  if(window._currentLagaId !== id){ _activeSetMap = {}; }
  window._scoreUIMode = 'modal';
  window._currentLagaId = id;
  openScoreModal(`<div class="score-modal">${scorePartaiFormHTML(l,'modal')}</div>`);
}
function selectBaganMatch(id){
  const l=DB.laga.find(x=>x.id===id);
  if(!l||!l.teamA||!l.teamB){
    Swal.fire({icon:'info',title:'Menunggu lawan',text:'Kedua tim belum ditentukan (menunggu hasil ronde sebelumnya).',confirmButtonColor:'#2563EB'});
    return;
  }
  if(window._currentLagaId !== id){ _activeSetMap = {}; }
  window._scoreUIMode = 'bagan';
  window._currentLagaId = id;
  drawBagan('baganBox', true);
  setTimeout(()=>{ const _bsp=document.getElementById('baganScorePanel'); if(_bsp) _bsp.scrollIntoView({behavior:'smooth', block:'start'}); }, 60);
}
function clearBaganSelection(){
  window._currentLagaId = null;
  window._scoreUIMode = null;
  drawBagan('baganBox', true);
}
/* Hitung ulang skor total, status, dan pemenang laga \u2014 lalu otomatis
   dorong hasilnya ke Bagan (advanceBagan) dan Jadwal (field status/skor
   pada DB.laga yang sama dipakai langsung oleh halaman Jadwal & Bagan). */
function recalcLagaResult(l){
  l.skorTeamA = l.partai.filter(x=>x.winner==='A').length;
  l.skorTeamB = l.partai.filter(x=>x.winner==='B').length;
  const totalMain = l.partai.filter(x=>x.winner).length;
  l.status = totalMain===0 ? 'Belum Main' : (l.skorTeamA>=3||l.skorTeamB>=3||totalMain===l.partai.length ? 'Selesai' : 'Sedang Main');
  if(l.status==='Selesai' && !l.pemenangTeam){
    l.pemenangTeam = l.skorTeamA>l.skorTeamB ? l.teamA : (l.skorTeamB>l.skorTeamA ? l.teamB : null);
    if(l.pemenangTeam){
      const winTeam = DB.teams.find(t=>t.id===l.pemenangTeam); if(winTeam) winTeam.poin += 1;
      addLog('Skor', `${l.ronde}: ${teamNama(l.teamA)} vs ${teamNama(l.teamB)} \u2014 pemenang ${teamNama(l.pemenangTeam)}`);
      advanceBagan(l);
    }
  }
}
/* Mode SET 1/2/3 (best of 3 set per partai) */
function updateSetScore(partaiIdx, setIdx, teamIdx, val){
  const l = DB.laga.find(x=>x.id===window._currentLagaId);
  const p = l.partai[partaiIdx];
  if(!p.sets) p.sets = [[0,0],[0,0],[0,0]];
  p.sets[setIdx][teamIdx] = Math.max(0, parseInt(val,10)||0);
  let winsA=0, winsB=0;
  p.sets.forEach(s=>{ if(s[0]>0||s[1]>0){ if(s[0]>s[1]) winsA++; else if(s[1]>s[0]) winsB++; } });
  p.winner = winsA>=2 ? 'A' : (winsB>=2 ? 'B' : null);
  lockPemainMain_(l, p);
  recalcLagaResult(l);
  saveDB();
  syncToGoogleSheet('SKOR','update', l);
  refreshScoreUI();
}
/* Mode SCORE 42 (skor langsung per partai, tanpa per-set) */
function updateScore42(partaiIdx, teamIdx, val){
  const l = DB.laga.find(x=>x.id===window._currentLagaId);
  const p = l.partai[partaiIdx];
  if(!p.score42) p.score42 = [0,0];
  p.score42[teamIdx] = Math.max(0, parseInt(val,10)||0);
  const a=p.score42[0], b=p.score42[1];
  p.winner = (a>0||b>0) ? (a>b?'A':(b>a?'B':null)) : null;
  lockPemainMain_(l, p);
  recalcLagaResult(l);
  saveDB();
  syncToGoogleSheet('SKOR','update', l);
  refreshScoreUI();
}
/* Ganti tampilan mode skor (tersimpan per-laga) */
function ubahModeScoreV2(mode){
  const l = DB.laga.find(x=>x.id===window._currentLagaId);
  if(!l) return;
  l.scoreMode = mode;
  saveDB();
  refreshScoreUI();
}
function renderSkorIfActive(){ if(hasClass_('[data-nav="skor"]','bg-primary',true)) renderSkor(); if(hasClass_('[data-nav="bagan"]','bg-primary',true)) renderBaganPage(); if(hasClass_('[data-nav="dashboard"]','bg-primary',true)) renderDashboard(); }

/* ---------- HASIL ---------- */
function renderHasil(){
  const rows = DB.laga.filter(l=>l.status!=='Belum Main');
  const ranking = DB.teams.slice().sort((a,b)=>b.poin-a.poin);
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Hasil &amp; Klasemen','Hasil pertandingan realtime', `<button onclick="smartPrint('Cetak Hasil &amp; Klasemen')" class="btn-ghost"><i class="fa-solid fa-print"></i> Cetak</button>`)}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-xl2 shadow-softer border border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-50 dark:divide-zinc-800">
        ${rows.map(l=>`<div class="p-4 flex items-center justify-between text-sm">
          <div><span class="badge bg-zinc-100 dark:bg-zinc-800 text-zinc-500 mr-2">${l.ronde}</span><b>${escapeHtml(teamNama(l.teamA))}</b> vs <b>${escapeHtml(teamNama(l.teamB))}</b></div>
          <div class="font-score text-2xl text-primary">${l.skorTeamA} - ${l.skorTeamB}</div>
        </div>`).join('') || emptyState('fa-ranking-star','Belum ada hasil','Hasil akan tampil setelah skor mulai diinput.')}
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <div class="font-display font-semibold text-sm mb-3">Klasemen Poin</div>
        ${ranking.map((t,i)=>`<div class="flex items-center gap-2 py-2 border-b border-zinc-50 dark:border-zinc-800 last:border-0 text-sm">
          <span class="w-5 text-center font-mono text-zinc-400">${i+1}</span>
          <span class="w-2 h-2 rounded-full" style="background:${t.warna}"></span>
          <span class="flex-1">${escapeHtml(t.nama)}</span><span class="font-display font-bold">${t.poin}</span>
        </div>`).join('')}
      </div>
    </div>`;
}

/* ---------- LAPORAN ---------- */
function renderLaporan(){
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Laporan','Ekspor data turnamen')}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <i class="fa-solid fa-user-group text-2xl text-primary mb-2"></i><div class="font-semibold text-sm mb-3">Data Peserta</div>
        <div class="flex gap-2"><button onclick="exportExcel('peserta')" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-file-excel text-emerald-600"></i> Excel</button><button onclick="exportPDF('peserta')" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-file-pdf text-red-600"></i> PDF</button></div>
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <i class="fa-solid fa-shuttlecock text-2xl text-primary mb-2"></i><div class="font-semibold text-sm mb-3">Jadwal &amp; Hasil</div>
        <div class="flex gap-2"><button onclick="exportExcel('laga')" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-file-excel text-emerald-600"></i> Excel</button><button onclick="exportPDF('laga')" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-file-pdf text-red-600"></i> PDF</button></div>
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <i class="fa-solid fa-ranking-star text-2xl text-primary mb-2"></i><div class="font-semibold text-sm mb-3">Klasemen Team</div>
        <div class="flex gap-2"><button onclick="exportExcel('teams')" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-file-excel text-emerald-600"></i> Excel</button><button onclick="smartPrint('Cetak Klasemen Team')" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-print"></i> Print</button></div>
      </div>
    </div>`;
}
function exportExcel(kind){
  let data, name;
  if(kind==='peserta'){ data = DB.peserta.map(p=>({NoRegistrasi:p.nomorRegistrasi, Koordinator:p.koordinator||'-', Nama:p.nama, Sekolah:p.asalSekolah, Gugus:p.gugus, Kategori:p.kategori.map(kategoriNama).join(', '), Tim:teamNama(p.teamId), Status:p.status})); name='peserta'; }
  else if(kind==='laga'){ data = DB.laga.map(l=>({Ronde:l.ronde, Tanggal:l.tanggal, Jam:l.jam, TeamA:teamNama(l.teamA), TeamB:teamNama(l.teamB), Skor:`${l.skorTeamA}-${l.skorTeamB}`, Status:l.status})); name='jadwal-hasil'; }
  else { data = DB.teams.map(t=>({Nama:t.nama, Koordinator:t.koordinator||'-', Poin:t.poin})); name='klasemen-team'; }
  const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, `${name}-${todayISO()}.xlsx`); addLog('Export','Mengekspor '+name+' ke Excel');
}
function exportPDF(kind){
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text(turnamenPlainText(), 14, 15);
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.text(kind==='peserta'?'Laporan Data Peserta':'Laporan Jadwal & Hasil', 14, 22);
  let y=32; doc.setFont('helvetica','bold');
  if(kind==='peserta'){
    doc.text('No', 14, y); doc.text('Nama', 26, y); doc.text('Sekolah', 90, y); doc.text('Status', 165, y); doc.setFont('helvetica','normal'); y+=6;
    DB.peserta.forEach((p,i)=>{ if(y>280){doc.addPage();y=15;} doc.text(String(i+1),14,y); doc.text(p.nama.slice(0,35),26,y); doc.text((p.asalSekolah||'').slice(0,30),90,y); doc.text(p.status,165,y); y+=6; });
  } else {
    doc.text('Ronde', 14, y); doc.text('Pertandingan', 45, y); doc.text('Skor', 160, y); doc.setFont('helvetica','normal'); y+=6;
    DB.laga.forEach(l=>{ if(y>280){doc.addPage();y=15;} doc.text(l.ronde,14,y); doc.text((teamNama(l.teamA)+' vs '+teamNama(l.teamB)).slice(0,50),45,y); doc.text(`${l.skorTeamA}-${l.skorTeamB}`,160,y); y+=6; });
  }
  doc.save(`${kind}-${todayISO()}.pdf`); addLog('Export','Mengekspor '+kind+' ke PDF');
}

/* ---------- BACKUP ---------- */
function renderBackup(){
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Backup Data','Cadangkan dan pulihkan seluruh data turnamen')}
    <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 mb-4">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div class="font-semibold text-sm mb-1"><i class="fa-solid fa-cloud text-primary mr-1"></i> Sinkronisasi Cloud (Google Sheet &amp; Drive)</div>
          <p class="text-xs text-zinc-400 max-w-md">Aplikasi ini bisa dibuka online oleh siapa saja lewat satu link (HP maupun laptop). Setiap perubahan otomatis tersimpan ke Google Sheet &amp; dicadangkan ke Google Drive, sehingga semua perangkat yang membuka link yang sama melihat data terbaru.</p>
          <div data-cloud-status class="mt-2"></div>
        </div>
        <div class="flex flex-col gap-2 shrink-0">
          <button onclick="manualCloudSync()" class="btn-primary text-xs"><i class="fa-solid fa-arrows-rotate"></i> Sinkron Sekarang</button>
          <button onclick="navigate('pengaturan')" class="btn-ghost text-xs"><i class="fa-solid fa-gear"></i> Atur URL Apps Script</button>
        </div>
      </div>
      ${!cloudSyncEnabled()?`<div class="mt-3 text-[11px] text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2"><i class="fa-solid fa-triangle-exclamation mr-1"></i> URL Apps Script belum diatur \u2014 data saat ini hanya tersimpan di perangkat ini (localStorage). Atur di menu Pengaturan agar data tersimpan online.</div>`:''}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <i class="fa-solid fa-cloud-arrow-down text-2xl text-primary mb-2"></i><div class="font-semibold text-sm mb-1">Unduh Backup (JSON)</div>
        <p class="text-xs text-zinc-400 mb-3">Simpan salinan seluruh data (peserta, tim, jadwal, skor) ke file JSON.</p>
        <button onclick="downloadBackup()" class="btn-primary text-xs"><i class="fa-solid fa-download"></i> Unduh Backup</button>
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
        <i class="fa-solid fa-rotate-left text-2xl text-primary mb-2"></i><div class="font-semibold text-sm mb-1">Pulihkan Data</div>
        <p class="text-xs text-zinc-400 mb-3">Unggah file backup JSON. Data saat ini akan digantikan.</p>
        <input type="file" id="restoreFile" accept=".json" class="hidden" onchange="restoreBackup(this)">
        <button onclick="document.getElementById('restoreFile').click()" class="btn-ghost text-xs"><i class="fa-solid fa-upload"></i> Pilih File Backup</button>
      </div>
    </div>`;
  updateCloudStatusUI();
}
function downloadBackup(){
  const blob = new Blob([JSON.stringify(DB,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`backup-badmintime-${todayISO()}.json`; a.click();
  addLog('Backup','Mengunduh backup data ke file JSON');
}
function restoreBackup(input){
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e=>{ try{ DB = JSON.parse(e.target.result); saveDB(); addLog('Backup','Memulihkan data dari file backup'); Swal.fire({icon:'success', title:'Data dipulihkan', confirmButtonColor:'#2563EB'}); navigate('dashboard'); }catch(err){ Swal.fire({icon:'error', title:'File tidak valid', confirmButtonColor:'#2563EB'}); } };
  reader.readAsText(file);
}

/* ---------- USER MGMT ---------- */
function renderUserMgmt(){
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Manajemen User','Kelola akun Administrator', `<button onclick="formUser()" class="btn-primary"><i class="fa-solid fa-user-plus"></i> Tambah User</button>`)}
    <div class="bg-white dark:bg-zinc-900 rounded-xl2 shadow-softer border border-zinc-100 dark:border-zinc-800 overflow-x-auto">
      <table class="w-full text-sm"><thead class="bg-zinc-50 dark:bg-zinc-800/40 text-left text-xs text-zinc-500"><tr><th class="px-4 py-3">Nama</th><th class="px-4 py-3">Username</th><th class="px-4 py-3">Peran</th><th class="px-4 py-3 text-right">Aksi</th></tr></thead>
      <tbody>${DB.users.map((u,i)=>`<tr class="border-t border-zinc-50 dark:border-zinc-800">
        <td class="px-4 py-3">${escapeHtml(u.nama)}</td><td class="px-4 py-3">${escapeHtml(u.username)}</td>
        <td class="px-4 py-3"><span class="badge bg-primary-light text-primary">${(ROLES.find(r=>r.id===u.role)||{}).label||u.role}</span></td>
        <td class="px-4 py-3 text-right">
          <button onclick="formUser(${i})" class="icon-btn text-primary" title="Edit / Ganti Password"><i class="fa-solid fa-pen"></i></button>
          <button onclick="deleteUser(${i})" class="icon-btn text-red-500" ${u.username===currentUser.username?'disabled style="opacity:.3"':''}><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join('')}</tbody></table>
    </div>`;
}
function formUser(editIndex){
  const isEdit = editIndex!==undefined && editIndex!==null;
  const u = isEdit ? DB.users[editIndex] : null;
  openModal(`<div class="p-6"><h3 class="font-display font-bold text-lg mb-4">${isEdit?'Edit User':'Tambah User'}</h3>
    <form onsubmit="return saveUser(event, ${isEdit?editIndex:'null'})" class="space-y-3 text-sm">
      <div><label class="lbl">Nama Lengkap</label><input class="inp" id="u_nama" value="${isEdit?escapeHtml(u.nama):''}" required></div>
      <div><label class="lbl">Username</label><input class="inp" id="u_user" value="${isEdit?escapeHtml(u.username):''}" required></div>
      <div><label class="lbl">${isEdit?'Password Baru (kosongkan jika tidak diganti)':'Password'}</label><input class="inp" type="password" id="u_pass" ${isEdit?'':'required'} placeholder="${isEdit?'\u2022\u2022\u2022\u2022\u2022\u2022 (tidak berubah)':''}"></div>
      <div><label class="lbl">Peran</label><select class="inp" id="u_role">${ROLES.map(r=>`<option value="${r.id}" ${isEdit&&u.role===r.id?'selected':''}>${r.label}</option>`).join('')}</select></div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn-ghost">Batal</button><button class="btn-primary"><i class="fa-solid fa-floppy-disk"></i> Simpan</button></div>
    </form></div>`);
}
function saveUser(e, editIndex){
  e.preventDefault();
  const nama = document.getElementById('u_nama').value.trim();
  const username = document.getElementById('u_user').value.trim();
  const pass = document.getElementById('u_pass').value;
  const role = document.getElementById('u_role').value;
  const isEdit = editIndex!==undefined && editIndex!==null;
  if(isEdit){
    const dup = DB.users.some((x,idx)=>idx!==editIndex && x.username===username);
    if(dup){ Swal.fire({icon:'error', title:'Username sudah dipakai', confirmButtonColor:'#2563EB'}); return false; }
    const u = DB.users[editIndex];
    const isSelf = !!(currentUser && currentUser.username===u.username);
    u.nama = nama; u.username = username; u.role = role;
    if(pass) u.password = pass;
    if(isSelf){
      currentUser = u;
      persistSession(u.username);
      document.getElementById('userNameTop').textContent = u.nama;
      document.getElementById('userAvatar').textContent = u.nama.slice(0,1).toUpperCase();
    }
    saveDB(); addLog('User','Mengubah data user '+username); closeModal(); renderUserMgmt();
  } else {
    const dup = DB.users.some(x=>x.username===username);
    if(dup){ Swal.fire({icon:'error', title:'Username sudah dipakai', confirmButtonColor:'#2563EB'}); return false; }
    if(!pass){ Swal.fire({icon:'error', title:'Password wajib diisi', confirmButtonColor:'#2563EB'}); return false; }
    DB.users.push({nama, username, password:pass, role});
    saveDB(); addLog('User','Menambahkan user baru'); closeModal(); renderUserMgmt();
  }
  return false;
}
function deleteUser(i){ if(DB.users[i].username===currentUser.username) return; DB.users.splice(i,1); saveDB(); renderUserMgmt(); }

/* ---------- Ganti Password (akun sendiri, lewat menu dropdown atas) ---------- */
function formChangeOwnPassword(){
  if(!currentUser) return;
  openModal(`<div class="p-6"><h3 class="font-display font-bold text-lg mb-1"><i class="fa-solid fa-key text-primary mr-1"></i> Ganti Password</h3>
    <p class="text-xs text-zinc-400 mb-4">Untuk akun: <b>${escapeHtml(currentUser.nama)}</b> (${escapeHtml(currentUser.username)})</p>
    <form onsubmit="return submitChangeOwnPassword(event)" class="space-y-3 text-sm">
      <div><label class="lbl">Password Saat Ini</label><input class="inp" type="password" id="cp_old" required></div>
      <div><label class="lbl">Password Baru</label><input class="inp" type="password" id="cp_new" required minlength="4"></div>
      <div><label class="lbl">Ulangi Password Baru</label><input class="inp" type="password" id="cp_new2" required minlength="4"></div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn-ghost">Batal</button><button class="btn-primary"><i class="fa-solid fa-floppy-disk"></i> Simpan</button></div>
    </form></div>`);
}
function submitChangeOwnPassword(e){
  e.preventDefault();
  const oldPass = document.getElementById('cp_old').value;
  const newPass = document.getElementById('cp_new').value;
  const newPass2 = document.getElementById('cp_new2').value;
  if(oldPass !== currentUser.password){ Swal.fire({icon:'error', title:'Password saat ini salah', confirmButtonColor:'#2563EB'}); return false; }
  if(newPass !== newPass2){ Swal.fire({icon:'error', title:'Konfirmasi password baru tidak sama', confirmButtonColor:'#2563EB'}); return false; }
  const liveUser = DB.users.find(u=>u.username===currentUser.username) || currentUser;
  liveUser.password = newPass;
  currentUser = liveUser;
  saveDB(); addLog('User', currentUser.nama+' mengganti password akunnya sendiri');
  closeModal();
  Swal.fire({toast:true, position:'top-end', icon:'success', title:'Password berhasil diganti', showConfirmButton:false, timer:2000});
  return false;
}

/* ---------- PENGATURAN ---------- */
const CODE_GS_CONTENT = `/**
 * ==========================================================================
 * KKGO CUP — TOURNAMENT MANAGEMENT SYSTEM — Google Apps Script Backend
 * ==========================================================================
 * FUNGSI:
 *  - Backend penyimpanan data untuk aplikasi KKGO CUP yang di-hosting di
 *    GitHub Pages (index.html + style.css + app.js). Apps Script INI hanya
 *    bertugas menyimpan & mengambil data lewat API JSON sederhana, supaya
 *    data peserta/tim/jadwal/skor/pengaturan tersimpan otomatis di Google
 *    Sheet & Google Drive, dan SAMA untuk semua orang yang membuka link
 *    GitHub Pages-nya (bukan hanya tersimpan di satu HP/laptop saja).
 *  - Seluruh data tersimpan sebagai JSON di Google Drive (sumber data utama,
 *    otomatis dicadangkan bertanggal & dipangkas maksimal 30 file), dan
 *    disalin ke beberapa tab Google Sheet (PESERTA, TEAM, JADWAL_LAGA,
 *    LOG_AKTIVITAS, INFO) supaya mudah dibaca/diperiksa manual.
 *
 * CARA PASANG:
 *  1. Buka Google Drive, buat folder baru, misalnya "KKGO CUP".
 *  2. Di dalam folder itu: klik Baru > Google Spreadsheet, beri nama bebas
 *     (mis. "KKGO CUP - Data"). Salin ID spreadsheet dari URL-nya
 *     (bagian di antara /d/ dan /edit).
 *  3. Masih di folder yang sama: klik Baru > Lainnya > Google Apps Script.
 *     Beri nama project, misalnya "KKGO CUP Backend".
 *  4. Di editor Apps Script, hapus semua isi file "Code.gs" bawaan, lalu
 *     tempel SELURUH kode di bawah komentar ini (TIDAK perlu membuat file
 *     HTML apa pun — frontend-nya sudah ada terpisah di GitHub Pages).
 *  5. Ganti nilai SPREADSHEET_ID di bawah dengan ID dari langkah 2.
 *  6. Klik Deploy > New deployment > pilih ikon roda gigi > Web app.
 *       - Execute as        : Me (akun Anda)
 *       - Who has access    : Anyone
 *     Klik Deploy, lalu izinkan (Authorize access) saat diminta.
 *  7. Salin URL yang diakhiri "/exec".
 *  8. Buka file config.js di paket aplikasi (GitHub Pages), tempel URL /exec
 *     tersebut menggantikan placeholder di baris GAS_WEB_APP_URL, lalu
 *     commit/upload ulang config.js. Mulai saat itu semua perubahan data
 *     otomatis tersimpan ke Google Sheet & Drive, dan SEMUA perangkat yang
 *     membuka link GitHub Pages yang sama otomatis tersambung & tersinkron
 *     - tidak perlu diatur manual lagi lewat menu Pengaturan tiap perangkat.
 *
 * MEMPERBARUI BACKEND:
 *  Jika kode di bawah ini diperbarui di kemudian hari, tempel ulang ke
 *  editor Apps Script, lalu Deploy > Manage deployments > klik ikon pensil
 *  > Version: New version > Deploy, supaya URL /exec yang sama otomatis
 *  memakai versi terbaru.
 * ==========================================================================
 */
const SPREADSHEET_ID = 'ID_SPREADSHEET_ANDA';
const BACKUP_FOLDER_NAME = 'KKGO_CUP_Backup';
const MAX_BACKUPS = 30;

/* ---------- Entry point web app ---------- */
function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'getdb') {
    return jsonOutput_({ ok: true, db: readDB_() });
  }
  return jsonOutput_({ ok: true, message: 'Backend KKGO CUP aktif. Gunakan ?action=getdb untuk mengambil data, atau kirim POST untuk menyimpan.' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'registerpeserta') {
      const result = registerPesertaAtomic_(body);
      return jsonOutput_(result);
    }
    if (body.action === 'savedb') {
      writeDBLocked_(body.db);
      return jsonOutput_({ ok: true, savedAt: new Date().toISOString() });
    }
    /* Kompatibilitas lama: sinkron satu entitas/baris ke tab sheet tertentu */
    const sheetName = (body.sheet || 'LOG_AKTIVITAS').toUpperCase();
    const action = body.action || 'create';
    const data = body.data || {};
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = getOrCreateSheet_(ss, sheetName);
    upsertRow_(sheet, data, action);
    return jsonOutput_({ ok: true, sheet: sheetName, action: action });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message });
  }
}

/* ---------- Penyimpanan utama: JSON lengkap di Google Drive ---------- */
function getBackupFolder_() {
  const ssFile = DriveApp.getFileById(SPREADSHEET_ID);
  const parents = ssFile.getParents();
  const root = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const it = root.getFoldersByName(BACKUP_FOLDER_NAME);
  return it.hasNext() ? it.next() : root.createFolder(BACKUP_FOLDER_NAME);
}

function readDB_() {
  const folder = getBackupFolder_();
  const it = folder.getFilesByName('db_current.json');
  if (!it.hasNext()) return null;
  try {
    return JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
  } catch (err) {
    return null;
  }
}

function writeDB_(db) {
  const folder = getBackupFolder_();
  const json = JSON.stringify(db);
  const it = folder.getFilesByName('db_current.json');
  if (it.hasNext()) it.next().setContent(json);
  else folder.createFile('db_current.json', json, MimeType.PLAIN_TEXT);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT+7', 'yyyyMMdd_HHmmss');
  folder.createFile('db_backup_' + stamp + '.json', json, MimeType.PLAIN_TEXT);
  pruneBackups_(folder);
  mirrorToSheets_(db);
}

/* ---------- Kunci penulisan (LockService) ----------
 * PENTING: Sebelumnya writeDB_ dipanggil langsung tanpa kunci. Kalau ada dua
 * permintaan simpan yang datang HAMPIR bersamaan (mis. admin menyimpan skor
 * DAN peserta lain mendaftar dalam detik yang sama), keduanya bisa
 * membaca file db_current.json versi lama secara bersamaan, lalu menulis
 * kembali versi masing-masing yang saling menimpa -> salah satu perubahan
 * hilang tanpa ada error yang terlihat. LockService.getScriptLock() memaksa
 * permintaan kedua MENUNGGU sampai permintaan pertama selesai membaca+
 * menulis, sebelum ia baru boleh membaca versi terbaru. Ini yang membuat
 * "savedb" (simpan seluruh data dari admin) dan "registerpeserta" (simpan
 * pendaftaran peserta) tidak lagi bisa saling menimpa. */
function withDbLock_(fn) {
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(30000); // tunggu maksimal 30 detik
  if (!gotLock) throw new Error('Server sedang sibuk menyimpan data lain, coba lagi sebentar.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function writeDBLocked_(db) {
  return withDbLock_(function () { writeDB_(db); return db; });
}

/* ---------- Pendaftaran peserta: ditambahkan LANGSUNG ke data server -----
 * Tidak seperti "savedb" (yang mengirim & menimpa SELURUH database dari
 * salinan lokal peserta), endpoint ini HANYA menambahkan peserta baru ke
 * data yang sudah tersimpan di server, di dalam kunci (lock). Jadi:
 *  - Kalau admin sedang offline, pendaftaran tetap masuk ke server (folder
 *    Drive + Google Sheet) seperti biasa, dan otomatis terlihat begitu
 *    admin login lagi / menarik data.
 *  - Kalau ada BANYAK peserta mendaftar hampir bersamaan dari HP
 *    berbeda-beda, tidak ada yang saling menimpa -> semua pendaftaran
 *    tersimpan, karena tiap pendaftaran hanya MENAMBAH, tidak menimpa
 *    seluruh database seperti mekanisme lama.
 */
function registerPesertaAtomic_(body) {
  return withDbLock_(function () {
    let db = readDB_();
    if (!db) db = { users: [], gugus: [], teams: [], peserta: [], laga: [], baganMeta: { generated: false, order: [] }, juaraTeamId: null, logs: [], settings: {} };
    if (!Array.isArray(db.peserta)) db.peserta = [];

    const incoming = Array.isArray(body.peserta) ? body.peserta : [];
    const existingIds = {};
    db.peserta.forEach(function (p) { if (p && p.id) existingIds[p.id] = true; });
    let addedCount = 0;
    incoming.forEach(function (p) {
      if (!p || !p.id) return;
      if (existingIds[p.id]) return; // sudah ada (mis. permintaan terkirim dua kali), jangan duplikat
      db.peserta.push(p);
      existingIds[p.id] = true;
      addedCount++;
    });

    // Perbarui metadata team terkait (mis. poin/status), kalau dikirim.
    // Hanya field yang dikirim yang diperbarui, tidak menimpa seluruh tim.
    if (body.team && body.team.id && Array.isArray(db.teams)) {
      const t = db.teams.find(function (x) { return x.id === body.team.id; });
      if (t) Object.keys(body.team).forEach(function (k) { if (k !== 'id') t[k] = body.team[k]; });
    }

    if (!Array.isArray(db.logs)) db.logs = [];
    db.logs.unshift({
      id: 'log-' + new Date().getTime() + '-' + Math.random().toString(36).slice(2, 8),
      waktu: new Date().toISOString(),
      jenis: 'Pendaftaran',
      ket: 'Server menerima ' + addedCount + ' peserta baru' + (body.nomorRegistrasi ? ' (' + body.nomorRegistrasi + ')' : ''),
      user: 'Sistem'
    });
    db.logs = db.logs.slice(0, 200);

    writeDB_(db);
    return { ok: true, added: addedCount, savedAt: new Date().toISOString() };
  });
}

function pruneBackups_(folder) {
  const files = [];
  const all = folder.getFiles();
  while (all.hasNext()) {
    const f = all.next();
    if (f.getName().indexOf('db_backup_') === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  for (let i = MAX_BACKUPS; i < files.length; i++) files[i].setTrashed(true);
}

/* ---------- Salin ringkasan data ke tab Google Sheet agar mudah dibaca ---------- */
function mirrorToSheets_(db) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  writeTable_(ss, 'PESERTA', db.peserta || [], ['id', 'nama', 'teamId', 'kategoriId', 'kategori', 'status', 'koordinator', 'asalSekolah', 'gugus']);
  writeTable_(ss, 'TEAM', db.teams || [], ['id', 'nama', 'koordinator', 'gugus', 'warna', 'poin']);
  const laga = (db.laga || []).map(function (l, idx) {
    return { id: l.id, ronde: l.ronde, mainKe: idx + 1, tanggal: l.tanggal, jam: l.jam, lapangan: l.lapangan, durasiMenit: l.durasiMenit, jedaMenit: l.jedaMenit, durasiKategori: l.durasiKategori, teamA: l.teamA, teamB: l.teamB, skorTeamA: l.skorTeamA, skorTeamB: l.skorTeamB, status: l.status };
  });
  writeTable_(ss, 'JADWAL_LAGA', laga, ['id', 'ronde', 'mainKe', 'tanggal', 'jam', 'lapangan', 'durasiMenit', 'jedaMenit', 'durasiKategori', 'teamA', 'teamB', 'skorTeamA', 'skorTeamB', 'status']);
  writeTable_(ss, 'LOG_AKTIVITAS', (db.logs || []).slice(0, 200), ['id', 'waktu', 'jenis', 'ket', 'user']);
  const info = ss.getSheetByName('INFO') || ss.insertSheet('INFO');
  info.clear();
  const namaTurnamen = ((db.settings && db.settings.namaTurnamen) || '').replace(/<[^>]+>/g, '');
  info.getRange(1, 1, 2, 2).setValues([['Terakhir disimpan', new Date().toISOString()], ['Nama Turnamen', namaTurnamen]]);
}

function writeTable_(ss, name, rows, cols) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
  if (rows.length) {
    const values = rows.map(function (r) {
      return cols.map(function (c) {
        const v = r[c];
        if (v === undefined || v === null) return '';
        return (typeof v === 'object') ? JSON.stringify(v) : v;
      });
    });
    sheet.getRange(2, 1, values.length, cols.length).setValues(values);
  }
  sheet.setFrozenRows(1);
}

/* ---------- Kompatibilitas lama: sinkron per entitas satuan ---------- */
function getOrCreateSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); sheet.appendRow(['id', 'updated_at']); sheet.setFrozenRows(1); }
  return sheet;
}

function upsertRow_(sheet, data, action) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].filter(String);
  if (headers.length === 0) headers = ['id', 'updated_at'];
  const incomingKeys = Object.keys(data);
  let headerChanged = false;
  incomingKeys.forEach(function (key) { if (headers.indexOf(key) === -1) { headers.push(key); headerChanged = true; } });
  if (headers.indexOf('updated_at') === -1) { headers.push('updated_at'); headerChanged = true; }
  if (headerChanged) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  data.updated_at = new Date().toISOString();
  const rowValues = headers.map(function (h) { const v = data[h]; if (v === undefined || v === null) return ''; return (typeof v === 'object') ? JSON.stringify(v) : v; });
  const idColIndex = headers.indexOf('id');
  let targetRow = -1;
  if (data.id && idColIndex > -1 && sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, idColIndex + 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) { if (String(ids[i][0]) === String(data.id)) { targetRow = i + 2; break; } }
  }
  if (targetRow > -1 && action !== 'create') sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
  else sheet.appendRow(rowValues);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
function downloadCodeGs(){
  const blob = new Blob([CODE_GS_CONTENT], {type:'text/plain'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Code.gs'; a.click();
  addLog('Pengaturan', 'Mengunduh berkas Code.gs untuk integrasi Google Apps Script');
}
/* ---------- Pengaturan Jadwal Pertandingan Otomatis ---------- */
/* Model baru (fleksibel per hari):
   - "Pertandingan" = 1 Main (1 kategori dalam 1 Partai). 1 Partai = 5 Main
     (mengikuti jumlah kategori aktif, biasanya 5: Tunggal Putra, Tunggal
     Putri, Ganda Putra, Ganda Putri, Mix Double).
   - Admin cukup isi per hari: Tanggal, Jam Mulai, Jumlah Pertandingan (Main)
     yang ditargetkan hari itu, Durasi per Pertandingan (menit), dan Jeda
     Antar Pertandingan (menit, opsional). Sistem menghitung sendiri jam
     mulai/selesai tiap Main, total waktu, dan perkiraan jam selesai \u2014 admin
     tidak perlu menghitung manual.
   - Total Partai dari bagan otomatis dipecah menurut jumlah hari (tombol
     "Bagi Rata Otomatis"), dan tetap bisa diubah manual per hari. */
function totalSlotBagan(){
  return (DB.baganMeta && DB.baganMeta.generated) ? DB.laga.reduce((a,l)=>a+((l.partai&&l.partai.length)||1),0) : 0;
}
function jumlahMainPerPartaiRata(){
  const totalLaga = DB.laga.length;
  const totalSlot = totalSlotBagan();
  return totalLaga>0 ? Math.round((totalSlot/totalLaga)*10)/10 : (DB.settings.kategoriAktif||KATEGORI.map(k=>k.id)).length;
}
function jadwalOtoDefaultState(){
  return { jumlahHari: 1, hari: { 1:{tanggal:'', jam:'08:00', jumlahPertandingan:15, durasiMenit:20, jedaMenit:0} } };
}
function jadwalOtoHariDefault(){ return { tanggal:'', jam:'08:00', jumlahPertandingan:15, durasiMenit:20, jedaMenit:0 }; }
function getJadwalOtoState(){
  if(!DB.settings.jadwalOtomatis) DB.settings.jadwalOtomatis = jadwalOtoDefaultState();
  const s = DB.settings.jadwalOtomatis;
  if(!s.hari) s.hari = {};
  if(!s.jumlahHari || s.jumlahHari<1) s.jumlahHari = 1;
  for(let i=1;i<=s.jumlahHari;i++){
    let h = s.hari[i];
    if(!h){ s.hari[i] = jadwalOtoHariDefault(); continue; }
    /* Migrasi dari skema lama (jumlahPartai + durasiKategori tunggal) */
    if(h.jumlahPertandingan==null && h.jumlahPartai!=null){
      const perPartai = jumlahMainPerPartaiRata()||5;
      h.jumlahPertandingan = Math.round(h.jumlahPartai*perPartai);
      if(h.jedaMenit==null) h.jedaMenit = 0;
      if(!h.durasiMenit) h.durasiMenit = h.durasiKategori || 20;
    }
    if(h.jumlahPertandingan==null) h.jumlahPertandingan = 15;
    if(h.durasiMenit==null) h.durasiMenit = 20;
    if(h.jedaMenit==null) h.jedaMenit = 0;
    if(!h.jam) h.jam = '08:00';
  }
  return s;
}
/* Hitung perkiraan (preview) total waktu & jam selesai 1 hari, berdasarkan
   jumlah pertandingan, durasi, jeda, dan jumlah lapangan yang tersedia. */
function hitungPerkiraanHari(jumlahPertandingan, durasiMenit, jedaMenit, jamMulai){
  const lap = Math.max(1, parseInt(DB.settings.jumlahLapangan,10)||1);
  const slots = Math.max(0, parseInt(jumlahPertandingan,10)||0);
  const durasi = Math.max(1, parseInt(durasiMenit,10)||1);
  const jeda = Math.max(0, parseInt(jedaMenit,10)||0);
  const rounds = slots>0 ? Math.ceil(slots/lap) : 0;
  const totalMenit = rounds>0 ? (rounds*durasi + Math.max(0,rounds-1)*jeda) : 0;
  const selesai = slots>0 ? addMinutesToTime(jamMulai||'08:00', totalMenit) : (jamMulai||'08:00');
  const perPartai = jumlahMainPerPartaiRata()||5;
  const estimasiPartai = slots>0 ? Math.max(1, Math.round(slots/perPartai)) : 0;
  return { lap, slots, totalMenit, selesai, estimasiPartai };
}
function fmtJam(menit){
  const j = Math.floor(menit/60), m = menit%60;
  return (j>0?`${j} jam`:'') + (j>0&&m>0?' ':'') + (m>0?`${m} menit`:(j>0?'':'0 menit'));
}
/* Kartu "Pengaturan Jadwal" \u2014 kini berada di halaman Jadwal (bukan Pengaturan),
   dibungkus no-print supaya tidak ikut tercetak, hanya tabel jadwal yang tercetak. */
function renderJadwalOtoCardHTML(){
  const s = getJadwalOtoState();
  const totalSlot = totalSlotBagan();
  return `<div class="bg-white dark:bg-zinc-900 rounded-xl2 shadow-softer border border-zinc-100 dark:border-zinc-800 mb-4 overflow-hidden no-print">
    <div class="p-5 flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background:#E1122F1A;color:#E1122F"><i class="fa-solid fa-calendar-days"></i></div>
      <div>
        <div class="font-semibold text-sm">Pengaturan Jadwal Pertandingan</div>
        <div class="text-xs text-zinc-400 mt-0.5">1 Partai = 5 Main (5 kategori). Tentukan jumlah hari, lalu untuk tiap hari cukup isi Tanggal, Jam Mulai, Jumlah Pertandingan (Main), Durasi per Pertandingan, dan Jeda Antar Pertandingan (jika ada) \u2014 total waktu &amp; jam selesai dihitung otomatis dan langsung ter-update saat nilai diubah.</div>
      </div>
    </div>
    <div class="px-5 pb-5 space-y-4">
      <div class="flex items-end gap-3 flex-wrap">
        <div><label class="lbl">Jumlah Hari Pertandingan</label><input type="number" min="1" max="14" id="jo_jumlahHari" class="inp w-28" value="${s.jumlahHari}" onchange="onJadwalOtoJumlahHariChange()"></div>
        <button type="button" onclick="tambahHariJadwal()" class="btn-ghost text-xs"><i class="fa-solid fa-plus"></i> Tambah Hari</button>
        <button type="button" onclick="bagiRataJadwalOtomatis()" class="btn-ghost text-xs"><i class="fa-solid fa-scale-balanced"></i> Bagi Rata Otomatis</button>
      </div>
      <div id="jo_hariFields" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
      <div class="flex flex-wrap items-center gap-3 pt-1">
        <button type="button" onclick="terapkanJadwalOtomatis()" class="btn-primary text-xs"><i class="fa-solid fa-calendar-check"></i> Terapkan Jadwal Otomatis</button>
        <span id="jo_totalInfo" class="text-[11px] text-zinc-400">${totalSlot?'':'Generate bagan terlebih dahulu di menu Bagan sebelum menerapkan jadwal otomatis.'}</span>
      </div>
    </div>
  </div>`;
}
function renderJadwalOtoFields(){
  const box = document.getElementById('jo_hariFields');
  if(!box) return;
  const s = getJadwalOtoState();
  const n = Number(s.jumlahHari)||1;
  let html = '';
  for(let i=1;i<=n;i++){
    const h = s.hari[i] || jadwalOtoHariDefault();
    html += `<div class="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
      <div class="flex items-center justify-between">
        <div class="font-semibold text-xs"><i class="fa-solid fa-calendar-day mr-1 text-primary"></i> Hari ke-${i}</div>
        ${n>1?`<button type="button" onclick="hapusHariJadwal(${i})" class="text-zinc-400 hover:text-red-500 text-xs" title="Hapus Hari ${i}"><i class="fa-solid fa-trash"></i></button>`:''}
      </div>
      <div><label class="lbl">Tanggal</label><input type="date" id="jo_tgl_${i}" class="inp" value="${h.tanggal||''}" oninput="saveJadwalOtoState()"></div>
      <div><label class="lbl">Jam Mulai</label><input type="time" id="jo_jam_${i}" class="inp" value="${h.jam||'08:00'}" oninput="saveJadwalOtoState()"></div>
      <div><label class="lbl">Jumlah Pertandingan (Main)</label><input type="number" min="1" id="jo_jml_${i}" class="inp" value="${h.jumlahPertandingan||15}" oninput="saveJadwalOtoState()"></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="lbl">Durasi/Pertandingan (menit)</label><input type="number" min="1" step="5" id="jo_dur_${i}" class="inp" value="${h.durasiMenit||20}" oninput="saveJadwalOtoState()"></div>
        <div><label class="lbl">Jeda Antar (menit)</label><input type="number" min="0" step="5" id="jo_jeda_${i}" class="inp" value="${h.jedaMenit||0}" oninput="saveJadwalOtoState()"></div>
      </div>
      <div class="jo-day-info" id="jo_info_${i}"></div>
    </div>`;
  }
  box.innerHTML = html;
  for(let i=1;i<=n;i++) updateJoDayInfo(i);
  updateJoTotalInfo();
}
/* Info per hari: total waktu & perkiraan selesai, otomatis update tiap kali
   admin mengubah jumlah pertandingan / durasi / jeda / jam mulai. */
function updateJoDayInfo(i){
  const el = document.getElementById('jo_info_'+i); if(!el) return;
  const jml = (document.getElementById('jo_jml_'+i) && document.getElementById('jo_jml_'+i).value);
  const dur = (document.getElementById('jo_dur_'+i) && document.getElementById('jo_dur_'+i).value);
  const jeda = (document.getElementById('jo_jeda_'+i) && document.getElementById('jo_jeda_'+i).value);
  const jam = (document.getElementById('jo_jam_'+i) && document.getElementById('jo_jam_'+i).value) || '08:00';
  const est = hitungPerkiraanHari(jml, dur, jeda, jam);
  el.innerHTML = `\u2248 ${est.estimasiPartai} Partai (${est.slots} Main) \u00B7 Total waktu: <b>${fmtJam(est.totalMenit)}</b> \u00B7 Perkiraan selesai: <b>${est.selesai}</b>${est.lap>1?` \u00B7 ${est.lap} lapangan paralel`:''}`;
}
function updateJoTotalInfo(){
  const el = document.getElementById('jo_totalInfo'); if(!el) return;
  const s = getJadwalOtoState();
  const totalSlot = totalSlotBagan();
  let totalRencana = 0;
  for(let i=1;i<=s.jumlahHari;i++) totalRencana += Number((s.hari[i]||{}).jumlahPertandingan)||0;
  if(!totalSlot){ el.textContent = 'Generate bagan terlebih dahulu di menu Bagan sebelum menerapkan jadwal otomatis.'; return; }
  const selisih = totalSlot - totalRencana;
  el.innerHTML = `Total direncanakan: <b>${totalRencana}</b> dari <b>${totalSlot}</b> pertandingan (Main) hasil bagan \u00B7 ${DB.settings.jumlahLapangan||1} lapangan`
    + (selisih>0 ? ` \u00B7 <span class="text-amber-500">sisa ${selisih} Main belum masuk hari manapun</span>` : (selisih<0 ? ` \u00B7 <span class="text-emerald-500">jumlah rencana melebihi total, kelebihan akan otomatis diabaikan</span>` : ` \u00B7 <span class="text-emerald-500">pas, seluruh Main terjadwalkan</span>`));
}
function onJadwalOtoJumlahHariChange(){
  const s = getJadwalOtoState();
  s.jumlahHari = Math.max(1, parseInt(document.getElementById('jo_jumlahHari').value,10) || 1);
  saveDB();
  renderJadwalOtoFields();
}
function tambahHariJadwal(){
  const s = getJadwalOtoState();
  s.jumlahHari = (Number(s.jumlahHari)||1) + 1;
  const jml = document.getElementById('jo_jumlahHari'); if(jml) jml.value = s.jumlahHari;
  getJadwalOtoState();
  saveDB();
  renderJadwalOtoFields();
}
function hapusHariJadwal(i){
  const s = getJadwalOtoState();
  if(s.jumlahHari<=1) return;
  for(let k=i;k<s.jumlahHari;k++) s.hari[k] = s.hari[k+1];
  delete s.hari[s.jumlahHari];
  s.jumlahHari -= 1;
  const jml = document.getElementById('jo_jumlahHari'); if(jml) jml.value = s.jumlahHari;
  saveDB();
  renderJadwalOtoFields();
}
function saveJadwalOtoState(){
  const s = getJadwalOtoState();
  for(let i=1;i<=s.jumlahHari;i++){
    const tgl = (document.getElementById('jo_tgl_'+i) && document.getElementById('jo_tgl_'+i).value) || '';
    const jam = (document.getElementById('jo_jam_'+i) && document.getElementById('jo_jam_'+i).value) || '08:00';
    const jml = parseInt((document.getElementById('jo_jml_'+i) && document.getElementById('jo_jml_'+i).value),10) || 1;
    const dur = parseInt((document.getElementById('jo_dur_'+i) && document.getElementById('jo_dur_'+i).value),10) || 20;
    const jeda = parseInt((document.getElementById('jo_jeda_'+i) && document.getElementById('jo_jeda_'+i).value),10) || 0;
    s.hari[i] = { tanggal:tgl, jam:jam, jumlahPertandingan:jml, durasiMenit:dur, jedaMenit:jeda };
    updateJoDayInfo(i);
  }
  saveDB();
  updateJoTotalInfo();
}
/* Bagi rata otomatis: total Main hasil bagan dibagi rata ke seluruh hari yang
   sudah ditentukan (sisa pembagian ditambahkan ke hari-hari pertama). Admin
   tetap bisa mengubah jumlah pertandingan tiap hari secara manual sesudahnya. */
function bagiRataJadwalOtomatis(){
  const total = totalSlotBagan();
  if(!total){ Swal.fire({icon:'warning', title:'Bagan belum dibuat', text:'Generate bagan terlebih dahulu di menu Bagan sebelum membagi rata jadwal.', confirmButtonColor:'#2563EB'}); return; }
  const s = getJadwalOtoState();
  const n = Math.max(1, Number(s.jumlahHari)||1);
  const base = Math.floor(total/n), extra = total%n;
  for(let i=1;i<=n;i++){
    if(!s.hari[i]) s.hari[i] = jadwalOtoHariDefault();
    s.hari[i].jumlahPertandingan = base + (i<=extra?1:0);
  }
  saveDB();
  renderJadwalOtoFields();
  Swal.fire({toast:true, position:'top-end', icon:'success', title:`Jumlah pertandingan dibagi rata ke ${n} hari`, showConfirmButton:false, timer:2000});
}
function addMinutesToTime(hhmm, mins){
  const parts = (hhmm||'08:00').split(':');
  const h = parseInt(parts[0],10)||0, m = parseInt(parts[1],10)||0;
  const d = new Date(2000,0,1,h,m);
  d.setMinutes(d.getMinutes()+mins);
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
/* Menjadwalkan pertandingan mengikuti urutan bagan (DB.baganMeta.order), per
   hari: tiap hari punya target Jumlah Pertandingan (Main). 1 Partai (5 Main)
   selalu tetap utuh dalam 1 hari yang sama (tidak dipotong tengah), dan
   ditempatkan di lapangan yang paling cepat kosong (round-robin cerdas) agar
   beberapa Partai bisa berjalan paralel jika lapangan > 1. Jam tiap Main
   dalam 1 Partai otomatis berurutan: Durasi per Pertandingan + Jeda Antar
   Pertandingan, tanpa admin perlu menghitung manual. */
function terapkanJadwalOtomatis(){
  if(!DB.baganMeta.generated || !DB.laga.length){
    Swal.fire({icon:'warning', title:'Bagan belum dibuat', text:'Generate bagan terlebih dahulu di menu Bagan sebelum menerapkan jadwal otomatis.', confirmButtonColor:'#2563EB'});
    return;
  }
  saveJadwalOtoState();
  const s = getJadwalOtoState();
  for(let i=1;i<=s.jumlahHari;i++){
    if(!s.hari[i] || !s.hari[i].tanggal){
      Swal.fire({icon:'warning', title:'Tanggal belum lengkap', text:'Isi Tanggal Hari '+i+' sebelum menerapkan jadwal otomatis.', confirmButtonColor:'#2563EB'});
      return;
    }
  }
  const order = DB.baganMeta.order;
  const lap = Math.max(1, parseInt(DB.settings.jumlahLapangan,10)||1);
  let cursor = 0;
  for(let i=1; i<=s.jumlahHari && cursor<order.length; i++){
    const h = s.hari[i];
    const target = Math.max(1, parseInt(h.jumlahPertandingan,10)||1);
    const durasi = Math.max(1, parseInt(h.durasiMenit,10)||20);
    const jeda = Math.max(0, parseInt(h.jedaMenit,10)||0);
    const spacing = durasi + jeda;
    const courtTime = Array(lap).fill(h.jam||'08:00');
    let daySlots = 0;
    while(daySlots < target && cursor < order.length){
      const laga = DB.laga.find(x=>x.id===order[cursor]);
      if(!laga){ cursor++; continue; }
      let ci = 0;
      for(let c=1;c<lap;c++){ if(courtTime[c] < courtTime[ci]) ci = c; }
      const slotCount = (laga.partai && laga.partai.length) || 1;
      laga.tanggal = h.tanggal;
      laga.jam = courtTime[ci];
      laga.lapangan = ci+1;
      laga.durasiMenit = durasi;
      laga.jedaMenit = jeda;
      laga.durasiKategori = spacing;
      courtTime[ci] = addMinutesToTime(courtTime[ci], slotCount*spacing);
      daySlots += slotCount;
      cursor++;
    }
  }
  saveDB();
  addLog('Jadwal', `Jadwal pertandingan diterapkan otomatis (${s.jumlahHari} hari, ${lap} lapangan)`);
  if(cursor < order.length){
    Swal.fire({icon:'warning', title:'Jadwal diterapkan sebagian', text:`${cursor} dari ${order.length} partai berhasil dijadwalkan. Tambah hari atau perbesar jumlah pertandingan per hari untuk menjadwalkan sisa ${order.length-cursor} partai.`, confirmButtonColor:'#2563EB'});
  } else {
    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Jadwal otomatis berhasil diterapkan', showConfirmButton:false, timer:2200});
  }
  if(hasClass_('[data-nav="jadwal"]','bg-primary',true)){ renderJadwalTable(); renderJadwalOtoFields(); }
  if(hasClass_('[data-nav="bagan"]','bg-primary',true)) renderBaganPage();
}
function renderPengaturan(){
  /* PERBAIKAN: siapkan teks draft daftar video SEBELUM template HTML di
     bawah dibangun, supaya textarea-nya langsung terisi teks yang benar
     saat pertama dirender (bukan lewat render-ulang terpisah setelahnya). */
  window._ytDraft = (DB.settings.youtubeVideos||[]).map(v=> v.title ? `${v.url} | ${v.title}` : (v.url||'')).join('\n');
  document.getElementById('mainContent').innerHTML = `
    ${pageHeader('Pengaturan','Preferensi turnamen &amp; integrasi')}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 space-y-3">
        <div class="font-semibold text-sm">Informasi Turnamen</div>
        <div><label class="lbl">Nama Turnamen</label><input id="p_nama" class="inp" value="${escapeHtml(DB.settings.namaTurnamen)}"></div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="lbl">Tanggal Mulai</label><input type="date" id="p_tglMulai" class="inp" value="${DB.settings.tanggalMulai}"></div>
          <div><label class="lbl">Tanggal Selesai</label><input type="date" id="p_tglSelesai" class="inp" value="${DB.settings.tanggalSelesai}"></div>
        </div>
        <div><label class="lbl">Lokasi</label><input id="p_lokasi" class="inp" value="${escapeHtml(DB.settings.lokasi)}"></div>
        <div><label class="lbl">Jumlah Lapangan</label><input type="number" min="1" id="p_lapangan" class="inp w-24" value="${DB.settings.jumlahLapangan}"></div>
        <button onclick="saveTurnamenInfo()" class="btn-primary text-xs"><i class="fa-solid fa-floppy-disk"></i> Simpan</button>
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 space-y-3">
        <div class="font-semibold text-sm">Logo Turnamen</div>
        <div class="flex items-center gap-3">
          <div id="logoPreviewBox" class="w-16 h-16 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden bg-zinc-50 dark:bg-zinc-800 shrink-0"></div>
          <div class="flex flex-col gap-2"><input type="file" id="logoInput" accept="image/*" class="hidden" onchange="handleLogoUpload(this)"><button onclick="document.getElementById('logoInput').click()" class="btn-primary text-xs"><i class="fa-solid fa-upload"></i> Unggah</button><button onclick="removeLogo()" class="btn-ghost text-xs"><i class="fa-solid fa-trash"></i> Hapus</button></div>
        </div>
        <div class="font-semibold text-sm pt-2">Kategori Aktif</div>
        <div id="kategoriAktifBox" class="grid grid-cols-2 gap-2"></div>
        <button onclick="saveKategoriAktif()" class="btn-primary text-xs"><i class="fa-solid fa-floppy-disk"></i> Simpan Kategori</button>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 space-y-3">
        <div class="font-semibold text-sm">Master Gugus</div>
        <p class="text-xs text-zinc-400">Daftar gugus yang muncul di dropdown form pendaftaran online. Bisa diisi manual atau impor dari Excel.</p>
        <div id="gugusList" class="flex flex-wrap gap-2"></div>
        <div class="flex gap-2"><input id="gugusNew" class="inp" placeholder="Nama gugus baru"><button onclick="addGugus()" class="btn-primary text-xs shrink-0"><i class="fa-solid fa-plus"></i></button></div>
        <div class="flex gap-2 pt-1">
          <input type="file" id="gugusImportInput" accept=".xlsx,.xls,.csv" class="hidden" onchange="importGugusExcel(this)">
          <button onclick="document.getElementById('gugusImportInput').click()" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-file-import"></i> Impor Excel</button>
          <button onclick="downloadGugusTemplate()" class="btn-ghost text-xs flex-1 justify-center"><i class="fa-solid fa-download"></i> Unduh Template</button>
        </div>
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 space-y-3">
        <div class="font-semibold text-sm"><i class="fa-solid fa-cloud text-primary mr-1"></i> Integrasi Google Apps Script (agar bisa diakses online)</div>
        <p class="text-xs text-zinc-400">Supaya aplikasi ini bisa dibuka siapa saja lewat satu link (HP/laptop) dengan data yang SAMA dan otomatis tersimpan (tidak hilang / balik ke awal): unduh <b>Code.gs</b>, ikuti langkah pemasangan di dalamnya, lalu tempel URL Web App (/exec) ke file <b>config.js</b> (bukan di sini) dan upload ulang ke GitHub. Dengan cara itu, URL-nya otomatis berlaku untuk SEMUA pengunjung link ini, bukan cuma perangkat Anda.</p>
        <input id="gasUrl" value="${escapeHtml(DB.settings.gasUrl)}" placeholder="https://script.google.com/macros/s/xxx/exec" class="inp font-mono text-xs" ${resolvedGasUrl_()?'disabled':''}>
        <div class="flex gap-2 flex-wrap">${resolvedGasUrl_()?'':`<button onclick="saveGasUrl()" class="btn-primary text-xs"><i class="fa-solid fa-link"></i> Simpan URL</button>`}<button onclick="downloadCodeGs()" class="btn-ghost text-xs"><i class="fa-solid fa-download"></i> Unduh Code.gs</button><button onclick="manualCloudSync()" class="btn-ghost text-xs"><i class="fa-solid fa-arrows-rotate"></i> Sinkron Sekarang</button></div>
        <div data-cloud-status></div>
        ${resolvedGasUrl_()?`<div class="text-[11px] text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2"><i class="fa-solid fa-circle-check mr-1"></i> URL backend diatur lewat <b>config.js</b> dan otomatis berlaku untuk semua perangkat yang membuka link ini. Kolom di atas dikunci supaya tidak beda sendiri per perangkat &mdash; untuk mengganti URL, edit config.js lalu upload ulang.</div>`
        : (DB.settings.gasUrl?`<div class="text-[11px] text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2"><i class="fa-solid fa-triangle-exclamation mr-1"></i> URL ini baru tersimpan di PERANGKAT INI saja (belum diisi di config.js), jadi perangkat lain yang membuka link belum otomatis tersambung. Supaya berlaku untuk semua orang, tempel URL yang sama ke config.js dan upload ulang ke GitHub.</div>`:'')}
        <div class="font-semibold text-sm pt-2">Keamanan Sesi</div>
        <div class="flex items-center gap-2"><input id="sessMin" type="number" min="5" max="120" value="${DB.settings.sessionTimeoutMin}" class="inp w-24"><button onclick="saveSessMin()" class="btn-ghost text-xs">Simpan</button></div>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 space-y-3">
        <div class="font-semibold text-sm"><i class="fa-brands fa-whatsapp text-emerald-500 mr-1"></i> Kontak WhatsApp Admin</div>
        <p class="text-xs text-zinc-400">Nomor ini dipakai untuk tombol "Chat WhatsApp" di halaman utama. Format bebas (mis. 08xx atau +62 8xx), otomatis dirapikan.</p>
        <div><label class="lbl">Nomor HP Admin</label><input id="p_waNumber" class="inp" placeholder="08xxxxxxxxxx" value="${escapeHtml(DB.settings.waNumber)}"></div>
        <div><label class="lbl">Pesan Default</label><textarea id="p_waMessage" rows="2" class="inp">${escapeHtml(DB.settings.waMessage)}</textarea></div>
        <button onclick="saveWaSettings()" class="btn-primary text-xs"><i class="fa-solid fa-floppy-disk"></i> Simpan Kontak WhatsApp</button>
      </div>
      <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 space-y-3">
        <div class="font-semibold text-sm"><i class="fa-brands fa-youtube text-red-600 mr-1"></i> Video &amp; Channel YouTube</div>
        <p class="text-xs text-zinc-400">Video akan tampil di halaman utama. Saat penonton klik video, tab baru terbuka ke channel Anda dengan tombol Subscribe siap diklik.</p>
        <div><label class="lbl">Link/Handle Channel YouTube</label><input id="p_ytChannel" class="inp" placeholder="https://youtube.com/@namachannel atau @namachannel" value="${escapeHtml(DB.settings.youtubeChannelUrl)}"></div>
        <div>
          <label class="lbl">Daftar Video</label>
          <p class="text-[11px] text-zinc-400 mb-1.5">Tempel link YouTube di sini, <b>satu link per baris</b> &mdash; bisa langsung tempel banyak link sekaligus. Judul video bersifat opsional, tulis setelah tanda <code class="px-1 rounded bg-zinc-100 dark:bg-zinc-800">|</code>.</p>
          <textarea id="ytVideoLinks" rows="6" class="inp w-full font-mono text-xs leading-relaxed" placeholder="https://youtu.be/xxxxxxxxxxx | Judul video (opsional)&#10;https://youtu.be/yyyyyyyyyyy&#10;https://youtu.be/zzzzzzzzzzz | Video ketiga" oninput="window._ytDraft=this.value;renderYtPreview();">${escapeHtml(window._ytDraft||'')}</textarea>
          <div id="ytLinesWarning" class="text-[11px] text-red-500 mt-1 hidden"></div>
        </div>
        <button onclick="saveYoutubeSettings()" class="btn-primary text-xs"><i class="fa-solid fa-floppy-disk"></i> Simpan Video &amp; Channel</button>
        <div class="pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div class="text-[11px] text-zinc-400 mb-2">Pratinjau tampilan di halaman utama:</div>
          <div id="ytPreviewBox" class="grid grid-cols-2 sm:grid-cols-3 gap-2"></div>
        </div>
      </div>
    </div>

    <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800 space-y-3 mb-4">
      <div class="font-semibold text-sm"><i class="fa-solid fa-calendar-days text-primary mr-1"></i> Pendaftaran &amp; Technical Handbook (THB)</div>
      <p class="text-xs text-zinc-400">Tanggal &amp; waktu di sini otomatis tampil di halaman utama, lengkap dengan hitungan mundur menuju penutupan pendaftaran dan batas akhir pembayaran.</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div><label class="lbl">Tanggal Pendaftaran Dibuka</label><input type="date" id="p_pendaftaranDibuka" class="inp" value="${DB.settings.pendaftaranDibuka||''}"></div>
        <div><label class="lbl">Tanggal &amp; Waktu Penutupan Pendaftaran</label><input type="datetime-local" id="p_pendaftaranDitutup" class="inp" value="${DB.settings.pendaftaranDitutup||''}"></div>
        <div><label class="lbl">Tanggal &amp; Waktu Batas Akhir Pembayaran</label><input type="datetime-local" id="p_batasBayar" class="inp" value="${DB.settings.batasBayarTanggal||''}"></div>
      </div>
      <button onclick="savePendaftaranSettings()" class="btn-primary text-xs"><i class="fa-solid fa-floppy-disk"></i> Simpan Pengaturan Pendaftaran</button>
      <div class="pt-3 border-t border-zinc-100 dark:border-zinc-800">
        <label class="lbl">Technical Handbook (THB) \u2014 file PDF, maks 5 MB</label>
        <div class="flex flex-wrap items-center gap-2">
          <input type="file" id="thbInput" accept="application/pdf" class="hidden" onchange="handleThbUpload(this)">
          <button onclick="document.getElementById('thbInput').click()" class="btn-primary text-xs"><i class="fa-solid fa-upload"></i> Unggah THB</button>
          <button onclick="removeThb()" class="btn-ghost text-xs"><i class="fa-solid fa-trash"></i> Hapus</button>
          <span id="thbFileInfo" class="text-xs text-zinc-400"></span>
        </div>
      </div>
    </div>
    <div class="bg-white dark:bg-zinc-900 rounded-xl2 p-5 shadow-softer border border-zinc-100 dark:border-zinc-800">
      <div class="font-semibold text-sm mb-2">Rencana Pengembangan</div>
      <ul class="text-xs text-zinc-400 space-y-1 list-disc pl-4">
        <li>Live scoring publik via tautan tanpa login</li>
        <li>Generator jadwal round-robin fase grup otomatis</li>
        <li>Cetak otomatis sertifikat peserta &amp; juara</li>
        <li>PWA \u2014 dapat dipasang di HP dan tetap jalan saat offline</li>
        <li>Pencegahan pertemuan tim segugus pada babak awal saat undian</li>
      </ul>
    </div>`;
  renderPengaturanUploads();
  renderYtPreview();
  updateCloudStatusUI();
}
function savePendaftaranSettings(){
  DB.settings.pendaftaranDibuka = document.getElementById('p_pendaftaranDibuka').value;
  DB.settings.pendaftaranDitutup = document.getElementById('p_pendaftaranDitutup').value;
  DB.settings.batasBayarTanggal = document.getElementById('p_batasBayar').value;
  saveDB();
  if(document.getElementById('landingPendaftaranSection')) renderLandingPendaftaranInfo();
  Swal.fire({toast:true, position:'top-end', icon:'success', title:'Pengaturan pendaftaran tersimpan', showConfirmButton:false, timer:1500});
}
function handleThbUpload(input){
  const file = input.files[0]; if(!file) return;
  if(file.type !== 'application/pdf'){
    Swal.fire({icon:'error', title:'Format tidak didukung', text:'Silakan unggah file PDF untuk Technical Handbook (THB).', confirmButtonColor:'#2563EB'});
    input.value=''; return;
  }
  if(file.size > 5*1024*1024){
    Swal.fire({icon:'error', title:'Ukuran file terlalu besar', text:'Ukuran maksimal file THB adalah 5 MB.', confirmButtonColor:'#2563EB'});
    input.value=''; return;
  }
  const reader = new FileReader();
  reader.onload = ()=>{
    DB.settings.thbUrl = reader.result;
    DB.settings.thbFileName = file.name;
    saveDB(); renderPengaturanUploads();
    if(document.getElementById('landingPendaftaranSection')) renderLandingPendaftaranInfo();
    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Technical Handbook tersimpan', showConfirmButton:false, timer:1500});
  };
  reader.onerror = ()=>{ Swal.fire({icon:'error', title:'Gagal membaca file', confirmButtonColor:'#2563EB'}); };
  reader.readAsDataURL(file);
  input.value='';
}
function removeThb(){
  DB.settings.thbUrl=''; DB.settings.thbFileName=''; saveDB(); renderPengaturanUploads();
  if(document.getElementById('landingPendaftaranSection')) renderLandingPendaftaranInfo();
}
function renderPengaturanUploads(){
  const logoBox = document.getElementById('logoPreviewBox');
  if(logoBox) logoBox.innerHTML = DB.settings.logoUrl ? `<img src="${DB.settings.logoUrl}" class="w-full h-full object-contain p-1">` : `<i class="fa-solid fa-shuttlecock text-zinc-300 text-xl"></i>`;
  const thbInfo = document.getElementById('thbFileInfo');
  if(thbInfo) thbInfo.innerHTML = DB.settings.thbUrl ? `<i class="fa-solid fa-file-pdf text-red-500 mr-1"></i> ${escapeHtml(DB.settings.thbFileName||'Technical-Handbook.pdf')}` : 'Belum ada file THB diunggah.';
  const kb = document.getElementById('kategoriAktifBox');
  if(kb) kb.innerHTML = KATEGORI.map(k=>`<label class="flex items-center gap-2 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2"><input type="checkbox" class="katAktif rounded border-zinc-300 text-primary" value="${k.id}" ${DB.settings.kategoriAktif.includes(k.id)?'checked':''}> ${k.nama}</label>`).join('');
  const gl = document.getElementById('gugusList');
  if(gl) gl.innerHTML = DB.gugus.map((g,i)=>`<span class="badge bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center gap-1">${escapeHtml(g)} <button onclick="removeGugus(${i})" class="text-zinc-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button></span>`).join('');
}
function saveTurnamenInfo(){
  DB.settings.namaTurnamen = document.getElementById('p_nama').value.trim();
  DB.settings.tanggalMulai = document.getElementById('p_tglMulai').value;
  DB.settings.tanggalSelesai = document.getElementById('p_tglSelesai').value;
  DB.settings.lokasi = document.getElementById('p_lokasi').value.trim();
  DB.settings.jumlahLapangan = parseInt(document.getElementById('p_lapangan').value,10)||1;
  saveDB(); renderBranding(); Swal.fire({toast:true, position:'top-end', icon:'success', title:'Tersimpan', showConfirmButton:false, timer:1500});
}
function saveWaSettings(){
  DB.settings.waNumber = document.getElementById('p_waNumber').value.trim();
  DB.settings.waMessage = document.getElementById('p_waMessage').value.trim();
  saveDB();
  addLog('Pengaturan','Memperbarui kontak WhatsApp admin');
  Swal.fire({toast:true, position:'top-end', icon:'success', title:'Kontak WhatsApp tersimpan', showConfirmButton:false, timer:1800});
}
/* ---------- Daftar Video YouTube: format tempel-banyak-sekaligus ----------
   Diganti dari model "klik Tambah Video lalu isi baris satu-satu" (rawan
   bikin admin bingung -- kalau lupa klik Tambah dulu, daftarnya kelihatan
   kosong padahal cuma belum ada barisnya) menjadi satu kotak teks: admin
   tinggal TEMPEL semua link YouTube sekaligus, satu link per baris. Judul
   opsional ditulis setelah tanda "|" di baris yang sama. */
function parseYtDraftLines(){
  return (window._ytDraft||'').split('\n').map(line=>{
    const raw = line;
    const trimmed = line.trim();
    if(!trimmed) return null;
    const parts = trimmed.split('|');
    const url = (parts[0]||'').trim();
    const title = parts.length>1 ? parts.slice(1).join('|').trim() : '';
    return { url, title, raw };
  }).filter(Boolean);
}
/* Pratinjau langsung di halaman Pengaturan, supaya admin langsung melihat
   video akan tampil seperti apa di halaman utama begitu link ditempel --
   dan menandai baris mana yang belum dikenali sebagai link YouTube, TANPA
   menggambar ulang textarea-nya (supaya kursor/fokus admin saat mengetik
   tidak terganggu). */
function renderYtPreview(){
  const box = document.getElementById('ytPreviewBox');
  const warnBox = document.getElementById('ytLinesWarning');
  if(!box) return;
  const lines = parseYtDraftLines();
  const valid = lines.filter(l=>extractYoutubeId(l.url));
  const invalid = lines.filter(l=>l.url && !extractYoutubeId(l.url));
  box.innerHTML = valid.length ? valid.map(v=>{
    const id = extractYoutubeId(v.url);
    return `<div class="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 aspect-video bg-zinc-100 dark:bg-zinc-800"><img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" class="w-full h-full object-cover" onerror="this.style.opacity=0.3"></div>`;
  }).join('') : `<div class="col-span-full text-[11px] text-zinc-400">Belum ada video valid \u2014 tempel link lengkap YouTube (mis. https://youtu.be/xxxxxxxxxxx).</div>`;
  if(warnBox){
    if(invalid.length){
      warnBox.classList.remove('hidden');
      warnBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${invalid.length} baris belum dikenali sebagai link YouTube yang valid: ` + invalid.map(l=>`<span class="font-mono">${escapeHtml(l.raw.trim().slice(0,40))}</span>`).join(', ');
    } else {
      warnBox.classList.add('hidden');
      warnBox.innerHTML = '';
    }
  }
}
function saveYoutubeSettings(){
  DB.settings.youtubeChannelUrl = document.getElementById('p_ytChannel').value.trim();
  const ta = document.getElementById('ytVideoLinks');
  if(ta) window._ytDraft = ta.value;
  const lines = parseYtDraftLines();
  const valid = lines.filter(l=>l.url && extractYoutubeId(l.url));
  const invalid = lines.filter(l=>l.url && !extractYoutubeId(l.url));
  DB.settings.youtubeVideos = valid.map(l=>({url:l.url, title:l.title}));
  saveDB();
  /* Isi textarea TIDAK disentuh setelah simpan -- baris yang valid tetap
     tersimpan & langsung tampil di halaman utama, sementara baris yang
     belum dikenali tetap ada di kotak teks (ditandai lewat ytLinesWarning)
     supaya admin bisa memperbaikinya, bukan mengetik ulang dari nol. */
  renderYtPreview();
  addLog('Pengaturan','Memperbarui pengaturan channel & video YouTube');
  if(invalid.length){
    Swal.fire({icon:'warning', title:'Sebagian link belum tersimpan', text:`${invalid.length} baris belum dikenali sebagai URL YouTube yang valid, jadi belum ikut tersimpan (tapi TIDAK dihapus dari kotak teks). Baris itu ditandai di bawah kotak teks \u2014 coba cek lagi link-nya, lalu klik Simpan lagi.`, confirmButtonColor:'#E1122F'});
  } else {
    Swal.fire({toast:true, position:'top-end', icon:'success', title:`${valid.length} video & channel YouTube tersimpan \u2014 cek Beranda untuk melihatnya`, showConfirmButton:false, timer:2200});
  }
}
function saveKategoriAktif(){
  DB.settings.kategoriAktif = Array.from(document.querySelectorAll('.katAktif:checked')).map(c=>c.value);
  saveDB(); Swal.fire({toast:true, position:'top-end', icon:'success', title:'Kategori aktif tersimpan', showConfirmButton:false, timer:1500});
}
function addGugus(){
  const v = document.getElementById('gugusNew').value.trim(); if(!v) return;
  if(DB.gugus.some(g=>g.toLowerCase()===v.toLowerCase())){ Swal.fire({icon:'warning', title:'Gugus sudah ada', confirmButtonColor:'#E1122F'}); return; }
  DB.gugus.push(v); saveDB(); document.getElementById('gugusNew').value=''; renderPengaturanUploads();
}
function removeGugus(i){ DB.gugus.splice(i,1); saveDB(); renderPengaturanUploads(); }
function downloadGugusTemplate(){
  const ws = XLSX.utils.json_to_sheet([{'Nama Gugus':'Cigombong'},{'Nama Gugus':'Ciciadeg'},{'Nama Gugus':'Cisalada'}]);
  ws['!cols'] = [{wch:30}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Gugus');
  XLSX.writeFile(wb, 'template-master-gugus.xlsx');
  addLog('Pengaturan','Mengunduh template Excel Master Gugus');
}
function importGugusExcel(input){
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      let added = 0, skipped = 0;
      rows.forEach(r=>{
        const nama = String(firstDefined_(r['Nama Gugus'], r['Gugus'], r['nama'], Object.values(r)[0], '')).trim();
        if(!nama) return;
        if(DB.gugus.some(g=>g.toLowerCase()===nama.toLowerCase())){ skipped++; return; }
        DB.gugus.push(nama); added++;
      });
      saveDB(); renderPengaturanUploads();
      addLog('Pengaturan', `Mengimpor ${added} gugus dari Excel${skipped?` (${skipped} duplikat dilewati)`:''}`);
      Swal.fire({icon:'success', title:'Impor selesai', text:`${added} gugus baru ditambahkan${skipped?`, ${skipped} duplikat dilewati`:''}.`, confirmButtonColor:'#E1122F'});
    }catch(err){
      Swal.fire({icon:'error', title:'Gagal membaca file', text:'Pastikan format file sesuai template (kolom "Nama Gugus").', confirmButtonColor:'#E1122F'});
    }
    input.value = '';
  };
  reader.readAsArrayBuffer(file);
}
async function handleLogoUpload(input){
  const file = input.files[0]; if(!file) return;
  try{ const url = await resizeImageFile(file, 500, 0.92, 'image/png'); DB.settings.logoUrl = url; saveDB(); renderBranding(); renderPengaturanUploads();
    Swal.fire({toast:true, position:'top-end', icon:'success', title:'Logo tersimpan', showConfirmButton:false, timer:1500});
  }catch(err){ Swal.fire({icon:'error', title:'Gagal mengunggah logo', text:err.message, confirmButtonColor:'#2563EB'}); }
  input.value='';
}
function removeLogo(){ DB.settings.logoUrl=''; saveDB(); renderBranding(); renderPengaturanUploads(); }
function saveGasUrl(){ DB.settings.gasUrl = document.getElementById('gasUrl').value.trim(); saveDB(); Swal.fire({toast:true, position:'top-end', icon:'success', title:'URL tersimpan', showConfirmButton:false, timer:1500}); }
function saveSessMin(){ DB.settings.sessionTimeoutMin = parseInt(document.getElementById('sessMin').value,10)||20; saveDB(); resetSessionTimer(); Swal.fire({toast:true, position:'top-end', icon:'success', title:'Tersimpan', showConfirmButton:false, timer:1500}); }

/* ---------- Delete & search ---------- */
function deleteRow(coll, id){
  if(!isAdmin()) return;
  Swal.fire({icon:'warning', title:'Hapus data ini?', showCancelButton:true, confirmButtonColor:'#2563EB', cancelButtonColor:'#94A3B8', confirmButtonText:'Hapus'}).then(r=>{
    if(!r.isConfirmed) return;
    DB[coll] = DB[coll].filter(x=>x.id!==id); saveDB(); addLog('Hapus Data','Menghapus data dari '+coll);
    navigate(location.hash.slice(1)||'dashboard');
  });
}
function globalSearch(q){
  const box = document.getElementById('searchResults');
  if(!q){ box.classList.add('hidden'); return; }
  const results = [
    ...DB.peserta.filter(p=>(p.nama+p.asalSekolah+p.nomorRegistrasi).toLowerCase().includes(q.toLowerCase())).map(p=>({label:p.nama, sub:'Peserta \u00B7 '+p.nomorRegistrasi, go:'peserta'})),
    ...DB.teams.filter(t=>t.nama.toLowerCase().includes(q.toLowerCase())).map(t=>({label:t.nama, sub:'Team', go:'team'})),
  ].slice(0,8);
  box.innerHTML = results.length ? results.map(r=>`<a href="#${r.go}" onclick="document.getElementById('searchResults').classList.add('hidden')" class="block px-4 py-2.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 border-b border-zinc-50 dark:border-zinc-700 last:border-0"><div class="font-medium">${escapeHtml(r.label)}</div><div class="text-zinc-400">${r.sub}</div></a>`).join('') : `<div class="px-4 py-3 text-xs text-zinc-400">Tidak ditemukan</div>`;
  box.classList.remove('hidden');
}

/* ---------- Style helpers (shared classes) ---------- */
const styleTag = document.createElement('style');
styleTag.textContent = `
  .lbl{display:block;font-size:11px;font-weight:600;color:#6B7280;margin-bottom:4px}
  .inp{width:100%;border:1px solid #E4E4E7;border-radius:10px;padding:9px 12px;font-size:13px;background:transparent;outline:none}
  .dark .inp{border-color:#3F3F46}
  .inp:focus{box-shadow:0 0 0 3px rgba(37,99,235,0.15);border-color:#2563EB}
  .btn-primary{background:#2563EB;color:white;font-weight:600;font-size:13px;padding:8px 16px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;box-shadow:0 8px 20px -8px rgba(37,99,235,0.5)}
  .btn-primary:hover{background:#1E3A8A}
  .btn-ghost{background:transparent;border:1px solid #E4E4E7;font-weight:600;font-size:13px;padding:8px 14px;border-radius:10px;display:inline-flex;align-items:center;gap:6px;color:#52525B}
  .dark .btn-ghost{border-color:#3F3F46;color:#D4D4D8}
  .btn-ghost:hover{background:#FAFAFA}
  .icon-btn{width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center}
  .icon-btn:hover{background:#F4F4F5}

  /* ---------- Menu Undian (roda putar penentu Gugus per Slot) ---------- */
  .undian-wheel-wrap{position:relative;display:flex;flex-direction:column;align-items:center}
  .undian-wheel-inner{position:relative;display:inline-block;line-height:0}
  .undian-pointer{position:absolute;top:-10px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:16px solid transparent;border-right:16px solid transparent;border-top:28px solid #E1122F;z-index:10}
  #undianWheel{display:block;border-radius:50%;box-shadow:0 6px 18px rgba(0,0,0,.22);background:#fff;max-width:100%;height:auto}
  .undian-spin-btn{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:84px;height:84px;border-radius:50%;font-size:12.5px;font-weight:800;color:#fff;background:linear-gradient(145deg,#2563EB,#1E3A8A);border:4px solid #fff;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3);z-index:5;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.15;padding:4px}
  .undian-spin-btn:disabled{background:#bdc3c7;cursor:not-allowed}
  .undian-winner-modal{display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(15,23,42,.96);color:#fff;padding:22px 26px;border-radius:16px;box-shadow:0 10px 28px rgba(0,0,0,.5);text-align:center;z-index:20;width:88%;max-width:300px;border:3px solid #f1c40f}
  .undian-winner-modal h4{margin:0 0 8px;font-size:13px;color:#f1c40f;letter-spacing:.5px}
  .undian-winner-modal .undian-winner-name{font-size:20px;font-weight:800;margin-bottom:14px;word-wrap:break-word;line-height:1.3}
  .undian-slot-item{background:#F8FAFC;margin-bottom:6px;padding:6px 10px;border-radius:8px;border-left:4px solid #CBD5E1;font-size:12px;font-weight:600;display:flex;justify-content:space-between;gap:8px}
  .dark .undian-slot-item{background:#27272A}
  .undian-slot-item.filled{border-left-color:#059669;background:#ECFDF5}
  .dark .undian-slot-item.filled{background:rgba(5,150,105,.15)}
  .undian-slot-item.next{border-left-color:#E1122F;box-shadow:0 0 0 2px rgba(225,18,47,.15)}
`;
document.head.appendChild(styleTag);

/* ---------- Init ---------- */
try{
  loadDB();
  updatePageTitle();
}catch(e){
  console.error('Gagal memuat data awal:', e);
  try{ DB = seedDB(); applyDBDefaults(); }catch(e2){ /* biarkan, tetap lanjut supaya tidak macet */ }
}
setTimeout(()=>{
  if(typeof window.__badmintimeForceHideLoading === 'function'){ window.__badmintimeForceHideLoading(); }
  else{
    document.getElementById('loadingScreen').style.opacity='0';
    document.getElementById('loadingScreen').style.transition='opacity .4s ease';
    setTimeout(()=>{ document.getElementById('loadingScreen').classList.add('hidden'); }, 400);
  }
  setTimeout(()=>{ document.getElementById('loadingScreen').classList.add('hidden'); restoreSessionAndBoot(); }, 400);
}, 1000);
