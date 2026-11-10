/* =========================================================
   GudangKita - Sistem Manajemen Stok & Peminjaman Gudang
   Data disimpan di localStorage (berfungsi sebagai "database" sisi klien).
   Catatan: role guard bersifat lapisan aplikasi, bukan keamanan server.

   DAFTAR ISI (urutan di file ini)
   1. Util umum & konstanta        6. Peminjaman & Pengembalian (+ modul Kendala)
   2. Database & session           7. Pembelian, Pengajuan, Rusak/MT, Hilang
   3. Toast & modal                8. Barang Habis Pakai / ATK
   4. Filter bersama               9. Users, kamera
   5. Navigasi, dashboard, barang 10. Riwayat aktivitas, notifikasi, riwayat event, auth
   ========================================================= */

const DB_KEY = 'gudangkita_db_v1';
const SESSION_KEY = 'gudangkita_session_v1';

/* ---------- Util umum ---------- */
function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
// Mengembalikan tanggal hari ini dalam format 'YYYY-MM-DD' (untuk input date & pencatatan).
function todayStr() { return localDateStr(new Date()); }
// Format 'YYYY-MM-DD' berdasarkan zona waktu perangkat (bukan UTC, agar tanggal tidak mundur sebelum jam 07.00 WIB).
function localDateStr(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Tanggal 'YYYY-MM-DD' untuk n hari yang lalu.
function daysAgoStr(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return localDateStr(d);
}
// Memformat sebuah tanggal menjadi format tampilan Indonesia (cth: 09 Sep 2026). Mengembalikan '-' jika kosong.
function fmtDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
// Memformat tanggal + waktu menjadi format tampilan Indonesia lengkap dengan jam:menit.
function fmtDateTime(d) {
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Memformat angka menjadi string mata uang Rupiah (cth: 'Rp 15.000').
function fmtRupiah(n) {
    n = Number(n) || 0;
    return 'Rp ' + n.toLocaleString('id-ID');
}
// Tanggal 'YYYY-MM-DD' -> 'DD/MM/YYYY' (tanpa konversi zona waktu). '-' bila kosong.
function fmtDMY(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '-';
}
const ITEM_CONDITIONS = [['baru', 'Baru'], ['second', 'Second']];
function itemCondBadge(c) {
    if (!c) return '-';
    const label = (ITEM_CONDITIONS.find(x => x[0] === c) || [c, c])[1];
    return `<span class="badge ${c === 'second' ? 'badge-warning' : 'badge-success'}">${escapeHtml(label)}</span>`;
}
// Nama barang beserta merk, cth: 'Laptop - Asus Vivobook 14'.
function itemFullName(name, brand) { return brand ? name + ' - ' + brand : name; }
// Label pilihan barang: nama + merk + kondisi, cth: 'Laptop - Mac Air 2017 [Second]'. Dipakai di semua dropdown & catatan.
function itemLabel(it) {
    const c = (ITEM_CONDITIONS.find(x => x[0] === it.condition) || [])[1];
    const dt = dateOf(it) ? fmtDMY(dateOf(it)) : '';
    return itemFullName(it.name, it.brand) + (c ? ' [' + c + (dt ? ' · ' + dt : '') + ']' : '');
}
// Info tambahan di dropdown: keterangan minus untuk barang Second.
function itemMinusMeta(it) {
    return (it.price ? ' &middot; ' + fmtRupiah(it.price) : '') + (it.condition === 'second' && it.conditionNote ? ' &middot; Minus: ' + escapeHtml(it.conditionNote) : '');
}
// Teks keterangan minus untuk tampilan: Baru -> 'Tidak ada'.
function itemMinusText(cond, note) { return cond === 'second' ? (note || '-') : (cond === 'baru' ? 'Tidak ada' : '-'); }
// Kolom info wajib per barang (tanggal, harga, kondisi, keterangan minus). pre = awalan id (diakhiri '-'), d = {date, price, condition, note}.
function itemInfoFields(pre, d) {
    d = d || {};
    const cond = d.condition || '';
    return `
    <div class="form-row">
        <div class="form-group"><label>Tanggal Pembelian/Input</label>
            <input type="date" id="${pre}date" value="${escapeHtml(d.date || todayStr())}" required>
            <small class="text-muted">Ditampilkan sebagai DD/MM/YYYY.</small></div>
        <div class="form-group"><label>Harga Satuan (Rp)</label>
            <input type="number" id="${pre}price" min="1" step="any" value="${d.price ? escapeHtml(d.price) : ''}" placeholder="cth: 150000" required></div>
    </div>
    <div class="form-group"><label>Kondisi Barang</label>
        <select id="${pre}cond" onchange="toggleMinusField('${pre}')" required>
            <option value="" disabled ${cond ? '' : 'selected'}>- Pilih kondisi -</option>
            ${ITEM_CONDITIONS.map(([v, l]) => `<option value="${v}" ${cond === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
    <div class="form-group" id="${pre}note-wrap" style="${cond === 'second' ? '' : 'display:none;'}">
        <label>Keterangan Kekurangan / Minus</label>
        <textarea id="${pre}note" rows="2" placeholder="cth: Terdapat goresan pada bagian samping.">${escapeHtml(d.note || '')}</textarea></div>`;
}
// Kolom keterangan minus hanya tampil bila kondisi = Second.
function toggleMinusField(pre) {
    document.getElementById(pre + 'note-wrap').style.display = document.getElementById(pre + 'cond').value === 'second' ? '' : 'none';
}
// Membaca & memvalidasi kolom info barang. Hasil: { data: {date, price, condition, conditionNote} } atau { error }.
function readItemInfo(pre) {
    const val = id => (document.getElementById(pre + id) || { value: '' }).value.trim();
    const date = val('date'), price = Number(val('price')), condition = val('cond'), note = val('note');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Tanggal wajib diisi.' };
    if (!(price > 0)) return { error: 'Harga satuan wajib diisi (lebih dari 0).' };
    if (!condition) return { error: 'Kondisi wajib dipilih (Baru / Second).' };
    if (condition === 'second' && !note) return { error: 'Keterangan minus wajib diisi untuk barang Second.' };
    return { data: { date, price, condition, conditionNote: condition === 'second' ? note : '' } };
}
// Meng-escape karakter HTML khusus (&, <, >, ", ') agar input pengguna aman disisipkan ke dalam HTML.
function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Kelompok role yang dipakai untuk hak akses menu & fitur.
const ROLE_ALL = ['staff', 'admin', 'manajemen'];
const ROLE_ADM = ['admin', 'manajemen'];

/* ---------- Lampiran Pengajuan Pembelian ---------- */
const ATTACHMENT_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const ATTACHMENT_MAX_SIZE = 3 * 1024 * 1024; // 3MB per file (bisa disesuaikan 2-5MB)
const ATTACHMENT_MAX_COUNT = 5;              // batas jumlah file per pengajuan
// Memformat ukuran file (bytes) menjadi label KB/MB yang mudah dibaca.
function fmtFileSize(bytes) {
    if (!bytes) return '0 KB';
    const kb = bytes / 1024;
    return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
// Mengecek apakah sebuah tipe MIME termasuk gambar (dipakai untuk menentukan cara preview lampiran).
function isImageAttachment(type) { return type && type.startsWith('image/'); }

/* ---------- Database (localStorage) ----------
   ITEMS_DATA_VERSION dinaikkan setiap kali daftar barang bawaan (import
   dari file Excel/data asli) diperbarui, supaya browser yang sudah
   punya data lama otomatis ikut diperbarui tanpa kehilangan riwayat
   peminjaman/pembelian/dll yang sudah dibuat. */
const ITEMS_DATA_VERSION = 3;
const IMPORTED_ITEMS = [
    { id: 'BRG0001', name: 'Laptop', brand: 'Asus Vivobook 14', category: 'Elektronik', stock: 2, unit: 'pcs', location: 'Gudang Utama', rack: '', minStock: 1,
      purchaseDate: '2026-11-09', condition: 'baru', conditionNote: '', price: 8000000 },
    { id: 'BRG0002', name: 'Monitor', brand: 'LG 24 inch', category: 'Elektronik', stock: 2, unit: 'pcs', location: 'Gudang Utama', rack: '', minStock: 1,
      purchaseDate: '2026-11-09', condition: 'second', conditionNote: 'Terdapat goresan ringan pada bagian belakang.', price: 1200000 },
    { id: 'BRG0003', name: 'Keyboard', brand: 'Logitech K380', category: 'Elektronik', stock: 3, unit: 'pcs', location: 'Gudang Utama', rack: '', minStock: 1,
      purchaseDate: '2026-11-09', condition: 'baru', conditionNote: '', price: 350000 }
];
// Membangun struktur database awal (default users + data barang impor + modul lain kosong),
// dipakai saat aplikasi pertama kali dijalankan di sebuah device (localStorage masih kosong).
function seedDB() {
    return {
        users: DEFAULT_ACCOUNTS.map(u => ({ ...u })),
        items: JSON.parse(JSON.stringify(IMPORTED_ITEMS)),
        loans: [], damages: [], purchases: [], requests: [], lost: [], consumables: [],
        activityLog: [], notifications: [], counters: {}, eventMeta: {},
        itemsDataVersion: ITEMS_DATA_VERSION
    };
}
// Memastikan semua koleksi database ada (untuk data lama yang dibuat sebelum modul tertentu ada).
function normalizeDB(db) {
    ['users', 'items', 'loans', 'damages', 'purchases', 'requests', 'lost', 'consumables', 'activityLog', 'notifications']
        .forEach(k => { db[k] = db[k] || []; });
    db.counters = db.counters || {};
    db.eventMeta = db.eventMeta || {};
    return db;
}
// Memisahkan stok yang dulu tercampur: pembelian yang kondisi/harga/keterangannya beda dari barangnya dipindah ke barang varian.
function migrateItemVariants(db) {
    let n = 0;
    db.purchases.slice().forEach(p => {
        const it = db.items.find(x => x.id === p.itemId);
        if (!it || !it.condition || !p.condition || sameInfo(it, p)) return;
        movePurchaseToVariant(db, p, it);
        n++;
    });
    return n;
}
// Memindahkan pengajuan pengembalian yang dulu menunggu Manajemen ke tahap Admin. Mengembalikan jumlah yang dipindah.
function migrateManagementReturnStage(db) {
    let n = 0;
    db.loans.forEach(l => { if (l.status === 'menunggu_manajemen_pengembalian') { l.status = 'menunggu_admin_pengembalian'; n++; } });
    return n;
}
// Rusak = permanen. Catatan rusak lama yang masih berstatus menunggu/proses (seolah bisa diperbaiki) dijadikan permanen.
// Perbaikan yang masih mungkin adalah Maintenance (MT). Mengembalikan jumlah catatan yang diperbaiki klasifikasinya.
function migrateDamageClassification(db) {
    let n = 0;
    db.damages.forEach(d => { if (d.type === 'rusak' && (d.status === 'menunggu' || d.status === 'proses')) { d.status = 'permanen'; n++; } });
    return n;
}
// Menulis database mentah ke localStorage. Mengembalikan false + toast jika penyimpanan penuh.
function persistDB(db) {
    try {
        localStorage.setItem(DB_KEY, JSON.stringify(db));
        return true;
    } catch (e) {
        toast('Penyimpanan penuh (foto terlalu besar/banyak). Data terakhir gagal disimpan.', 'danger');
        return false;
    }
}
// Membaca database dari localStorage (dibuat dari seedDB() bila belum ada / rusak). Bila versi data
// barang berbeda dari ITEMS_DATA_VERSION, daftar barang dimigrasikan tanpa menghapus riwayat lain.
function getDB() {
    let db = null;
    try { db = JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { db = null; }
    if (!db) {
        db = seedDB();
        localStorage.setItem(DB_KEY, JSON.stringify(db));
        return db;
    }
    normalizeDB(db);
    // Alur lama: pengembalian bermasalah menunggu Manajemen. Sekarang hanya Admin yang memutuskan,
    // jadi pengajuan yang tertahan di tahap Manajemen dipindah ke antrean Admin (tidak ada data yang dihapus).
    const migrated = migrateManagementReturnStage(db) + migrateDamageClassification(db) + migrateItemVariants(db);
    if (migrated) localStorage.setItem(DB_KEY, JSON.stringify(db));
    if (db.itemsDataVersion !== ITEMS_DATA_VERSION) {
        db.items = JSON.parse(JSON.stringify(IMPORTED_ITEMS));
        // Transaksi yang menunjuk barang lama ikut dikosongkan agar tidak ada referensi yatim.
        // Users, pengajuan pembelian, dan counter ID form tidak disentuh.
        db.loans = []; db.damages = []; db.purchases = []; db.lost = []; db.consumables = [];
        db.activityLog = []; db.notifications = []; db.eventMeta = {};
        db.itemsDataVersion = ITEMS_DATA_VERSION;
        localStorage.setItem(DB_KEY, JSON.stringify(db));
    }
    return db;
}
// Menyimpan database. Sebelum disimpan, perubahan dibandingkan dengan data lama untuk memberi ID form,
// mencatat riwayat aktivitas, dan membuat notifikasi (lihat bagian RIWAYAT & NOTIFIKASI).
const INFO_PROTECTED = {
    items: ['purchaseDate', 'price', 'condition', 'conditionNote'],
    purchases: ['date', 'price', 'condition', 'conditionNote']
};
// Penjaga di lapisan simpan: selain Admin/Manajemen, perubahan field info barang (tanggal, harga, kondisi,
// keterangan minus), penambahan, dan penghapusan data barang/pembelian dibatalkan. Stok tetap boleh berubah
// (dipakai alur peminjaman/pengembalian). Mengembalikan false bila ada perubahan yang dibatalkan.
function enforceInfoAccess(oldDb, db) {
    if (hasRole('manajemen')) return true;
    // Admin boleh mengubah info barang, tetapi penghapusan riwayat pembelian hanya untuk Manajemen.
    const full = !hasRole(...ROLE_ADM);
    let ok = true;
    Object.keys(INFO_PROTECTED).forEach(coll => {
        if (!full && coll !== 'purchases') return;
        const oldList = oldDb && oldDb[coll];
        if (!Array.isArray(oldList)) return;
        const cur = db[coll] || [];
        const oldById = {}; oldList.forEach(r => { oldById[r.id] = r; });
        const curIds = new Set(cur.map(r => r.id));
        const missing = oldList.filter(r => !curIds.has(r.id));
        if (missing.length) ok = false;
        let kept = cur;
        if (full) {
            kept = cur.filter(r => oldById[r.id]);
            if (kept.length !== cur.length) ok = false;
            kept.forEach(r => INFO_PROTECTED[coll].forEach(f => {
                const before = oldById[r.id][f];
                if (r[f] !== before) { if (before === undefined) delete r[f]; else r[f] = before; ok = false; }
            }));
        }
        db[coll] = kept.concat(missing);
    });
    return ok;
}
function saveDB(db) {
    let oldDb = {};
    try { oldDb = JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch (e) { /* data lama rusak: abaikan */ }
    if (!enforceInfoAccess(oldDb, db)) toast('Akses ditolak: hanya Admin atau Manajemen yang boleh mengubah informasi barang.', 'danger');
    try { syncHistory(oldDb, db, false); } catch (e) { console.error('Sinkronisasi riwayat gagal', e); }
    const ok = persistDB(db);
    refreshBell();
    return ok;
}

/* ---------- Session ---------- */
function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
// Menyimpan data sesi pengguna yang berhasil login ke localStorage.
function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id: user.id, username: user.username, name: user.name, role: user.role }));
}
// Menghapus sesi login (dipakai saat logout).
function clearSession() { localStorage.removeItem(SESSION_KEY); }
// Alias singkat untuk mengambil data pengguna yang sedang login.
function currentUser() { return getSession(); }
// Mengecek apakah role pengguna yang sedang login termasuk salah satu dari role yang diberikan.
function hasRole(...roles) {
    const u = currentUser();
    return !!u && roles.includes(u.role);
}

/* ---------- Toast ---------- */
function toast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'success' ? 'check-circle' : type === 'danger' ? 'x-circle' : 'alert-triangle';
    el.innerHTML = `<i data-lucide="${icon}"></i><span>${escapeHtml(msg)}</span>`;
    container.appendChild(el);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => { el.remove(); }, 3800);
}

/* ---------- Modal ---------- */
function openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}
// Menutup modal dan mengosongkan isinya.
function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal-body').innerHTML = '';
}

/* =========================================================
   FILTER BERSAMA (pencarian / tanggal / bulan / tahun / status / kategori)
   Satu mekanisme untuk semua halaman: state per halaman disimpan di FILTERS, kontrolnya dibuat
   oleh filterBar(), dan perubahan apa pun merender ulang halaman aktif (kursor pencarian dipertahankan).
   ========================================================= */
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const FILTER_DEFAULTS = { q: '', d: '', m: '', y: '', st: '', cat: '', f: 'all' };
const FILTERS = {};
// Mengambil state filter sebuah halaman (dibuat otomatis saat pertama dipakai).
function filterState(name) {
    if (!FILTERS[name]) FILTERS[name] = { ...FILTER_DEFAULTS };
    return FILTERS[name];
}
// Mengecek apakah sebuah tanggal ('YYYY-MM-DD...') lolos filter tanggal/bulan/tahun.
function dateMatches(F, date) {
    date = String(date || '').slice(0, 10);
    return (!F.d || date === F.d) && (!F.m || date.slice(5, 7) === F.m) && (!F.y || date.slice(0, 4) === F.y);
}
// Mengecek apakah salah satu field memuat kata kunci pencarian (tanpa membedakan huruf besar/kecil).
function queryMatches(q, fields) {
    return !q || fields.join(' ').toLowerCase().includes(q.toLowerCase());
}
// Mengubah satu nilai filter lalu merender ulang halaman; fokus & posisi kursor kolom cari dipertahankan.
function setFilter(name, key, value) {
    filterState(name)[key] = value;
    const active = document.activeElement;
    const caret = active && active.selectionStart;
    renderPage(currentPage);
    if (key === 'q') {
        const input = document.querySelector('[data-k="q"]');
        if (input) { input.focus(); try { input.setSelectionRange(caret, caret); } catch (e) { /* tipe input tanpa kursor */ } }
    }
}
// Mengosongkan semua filter sebuah halaman.
function resetFilter(name) {
    FILTERS[name] = { ...FILTER_DEFAULTS };
    renderPage(currentPage);
}
// Daftar tahun untuk dropdown filter: tahun yang muncul di data + tahun berjalan.
function yearOptions(dates) {
    const years = new Set(dates.map(d => String(d || '').slice(0, 4)).filter(y => y.length === 4));
    years.add(String(new Date().getFullYear()));
    return [...years].sort().reverse();
}
// Dropdown filter generik. options: [[value, label], ...]
function filterSelect(name, key, options, allLabel) {
    const F = filterState(name);
    return `<select onchange="setFilter('${name}','${key}',this.value)"><option value="">${allLabel}</option>${options.map(([v, label]) =>
        `<option value="${escapeHtml(v)}" ${F[key] === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`;
}
// Bar filter lengkap: [cari] [tanggal] [bulan] [tahun] [extra...] [Reset].
// opts: { placeholder (kosong = tanpa kolom cari), years (array tahun), extra (HTML tambahan, mis. dropdown status) }
function filterBar(name, opts) {
    const F = filterState(name);
    const search = opts.placeholder
        ? `<input type="text" data-k="q" placeholder="${escapeHtml(opts.placeholder)}" value="${escapeHtml(F.q)}" oninput="setFilter('${name}','q',this.value)">` : '';
    const monthOptions = MONTH_NAMES.map((n, i) => [String(i + 1).padStart(2, '0'), n]);
    return `<div class="filter-bar rv-filter">${search}
        <input type="date" value="${F.d}" onchange="setFilter('${name}','d',this.value)" title="Tanggal">
        ${filterSelect(name, 'm', monthOptions, 'Semua bulan')}
        <select onchange="setFilter('${name}','y',this.value)"><option value="">Semua tahun</option>${(opts.years || yearOptions([])).map(y =>
            `<option ${F.y === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
        ${opts.extra || ''}
        <button class="btn btn-secondary btn-sm" onclick="resetFilter('${name}')">Reset</button></div>`;
}

/* ---------- Navigasi (menu per role) ----------
   Urutan menu utama sesuai alur kerja gudang. Menu "bawah" (Riwayat & Notifikasi) dipisah
   oleh jarak (gap) di sidebar. Role yang tidak berhak tidak melihat menunya sama sekali. */
const NAV_MAIN = [
    { id: 'dashboard',   label: 'Dashboard',            icon: 'layout-dashboard', roles: ROLE_ALL },
    { id: 'items',       label: 'Data Barang',          icon: 'package',          roles: ROLE_ALL },
    { id: 'loans',       label: 'Peminjaman',           icon: 'arrow-up-right',   roles: ROLE_ALL },
    { id: 'returns',     label: 'Pengembalian',         icon: 'corner-down-left', roles: ROLE_ALL },
    { id: 'requests',    label: 'Pengajuan Pembelian',  icon: 'file-text',        roles: ROLE_ALL },
    { id: 'purchases',   label: 'Pembelian Barang',     icon: 'shopping-cart',    roles: ROLE_ADM },
    { id: 'damages',     label: 'Barang Rusak / MT',    icon: 'wrench',           roles: ROLE_ADM },
    { id: 'lost',        label: 'Barang Hilang',        icon: 'search-x',         roles: ROLE_ADM },
    { id: 'consumables', label: 'Barang Habis Pakai',   icon: 'package-minus',    roles: ROLE_ADM },
    { id: 'users',       label: 'Manajemen User',       icon: 'users',            roles: ['manajemen'] }
];
const NAV_BOTTOM = [
    { id: 'history',       label: 'Riwayat Aktivitas', icon: 'history', roles: ROLE_ADM },
    { id: 'notifications', label: 'Notifikasi',        icon: 'bell',    roles: ROLE_ALL }
];
// Judul yang ditampilkan di topbar untuk masing-masing halaman (pageId).
const PAGE_TITLES = {
    dashboard: 'Dashboard', items: 'Data Barang', loans: 'Peminjaman', returns: 'Pengembalian',
    requests: 'Pengajuan Pembelian', purchases: 'Pembelian Barang Baru', damages: 'Barang Rusak / Maintenance',
    lost: 'Barang Hilang', consumables: 'Barang Habis Pakai / ATK', users: 'Manajemen User',
    history: 'Riwayat Aktivitas', notifications: 'Notifikasi'
};
let currentPage = 'dashboard'; // halaman yang sedang aktif ditampilkan

// Mengecek apakah role user saat ini boleh membuka suatu halaman (berdasarkan konfigurasi menu).
function canAccessPage(pageId) {
    const entry = [...NAV_MAIN, ...NAV_BOTTOM].find(n => n.id === pageId);
    return !!entry && hasRole(...entry.roles);
}

// Menghitung jumlah aksi PEMINJAMAN (pengajuan pinjam baru) yang butuh perhatian user saat ini,
// untuk badge menu "Peminjaman": admin -> jumlah pengajuan menunggu persetujuannya;
// staff -> jumlah pengajuannya sendiri yang masih menunggu admin; manajemen tidak terlibat di sini.
function loanActionCount() {
    const db = getDB();
    const u = currentUser();
    if (!u) return 0;
    if (u.role === 'admin') return db.loans.filter(l => l.status === 'menunggu_admin').length;
    if (u.role === 'manajemen') return 0;
    return db.loans.filter(l => l.requestedBy === u.name && l.status === 'menunggu_admin').length;
}
// Menghitung jumlah aksi PENGEMBALIAN yang butuh perhatian user saat ini, untuk badge menu
// "Pengembalian": admin -> pengajuan pengembalian yang menunggu persetujuan Admin; manajemen -> tidak ada
// (hanya memantau); staff -> pengajuan pengembalian miliknya sendiri yang masih menunggu Admin.
function returnActionCount() {
    const db = getDB();
    const u = currentUser();
    if (!u) return 0;
    if (u.role === 'admin') return db.loans.filter(l => l.status === 'menunggu_admin_pengembalian').length;
    if (u.role === 'manajemen') return 0;
    return db.loans.filter(l => l.returnSubmittedBy === u.name && l.status === 'menunggu_admin_pengembalian').length;
}
// Membangun dan merender menu sidebar sesuai role pengguna, lengkap dengan badge jumlah item yang menunggu.
function renderSidebar() {
    const nav = document.getElementById('sidebar-nav');
    const user = currentUser();
    if (!user) return;
    const db = getDB();
    const badgeCount = id => {
        if (id === 'requests' && hasRole('admin')) return db.requests.filter(r => r.status === 'pending').length;
        if (id === 'loans') return loanActionCount();
        if (id === 'returns') return returnActionCount();
        if (id === 'notifications') return unreadCount();
        return 0;
    };
    const itemHtml = it => {
        const n = badgeCount(it.id);
        return `<div class="nav-item ${currentPage === it.id ? 'active' : ''}" role="link" tabindex="0"${currentPage === it.id ? ' aria-current="page"' : ''}
            onclick="navigateTo('${it.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
            <i data-lucide="${it.icon}"></i><span>${escapeHtml(it.label)}</span>${n > 0 ? `<span class="nav-badge">${n}</span>` : ''}
        </div>`;
    };
    const visible = list => list.filter(it => it.roles.includes(user.role));
    nav.innerHTML = visible(NAV_MAIN).map(itemHtml).join('')
        + '<div class="nav-spacer"></div>'
        + visible(NAV_BOTTOM).map(itemHtml).join('');
    if (window.lucide) lucide.createIcons();
}
// Berpindah ke halaman lain: memperbarui state halaman aktif, judul, sidebar, lalu merender kontennya.
function navigateTo(pageId) {
    currentPage = pageId;
    dashFocus = '';                                   // daftar detail kartu dashboard ditutup saat pindah halaman
    if (pageId !== 'items') dashFromCard = false;     // tombol "Kembali ke Dashboard" hanya untuk Data Barang yang dibuka dari kartu
    document.getElementById('page-title').textContent = PAGE_TITLES[pageId] || '';
    document.getElementById('sidebar').classList.remove('open');
    renderSidebar();
    renderPage(pageId);
}
// Fungsi render untuk setiap halaman (pageId -> fungsi yang menghasilkan HTML halaman).
const PAGE_RENDERERS = {
    dashboard: renderDashboard, items: renderItemsPage, loans: renderLoansPage, returns: renderReturnsPage,
    requests: renderRequestsPage, purchases: renderPurchasesPage, damages: renderDamagesPage, lost: renderLostPage,
    consumables: renderConsumablesPage, users: renderUsersPage, history: renderHistoryPage, notifications: renderNotificationsPage
};
// Merender konten halaman ke area konten, lalu menjalankan hook setelah-render (jika ada).
function renderPage(pageId) {
    const render = PAGE_RENDERERS[pageId] || renderDashboard;
    document.getElementById('content-area').innerHTML = canAccessPage(pageId)
        ? render()
        : '<p class="text-muted">Anda tidak memiliki akses ke halaman ini.</p>';
    if (window.lucide) lucide.createIcons();
    if (afterRenderHooks[pageId]) afterRenderHooks[pageId]();
}

// Kode tambahan yang dijalankan setelah HTML suatu halaman selesai dirender,
// misalnya untuk inisialisasi elemen dinamis yang tidak bisa dilakukan lewat HTML string biasa.
const afterRenderHooks = {
    loans: function () {
        // Saat tab "Peminjaman Event" pertama kali dibuka, otomatis tambahkan satu baris barang kosong.
        if (loanTab === 'event') {
            const wrap = document.getElementById('event-items-wrap');
            if (wrap && !wrap.children.length) addEventItemRow();
        }
    }
};

/* =========================================================
   KOMPONEN CARD LIST (dipakai SEMUA halaman yang dulunya tabel)
   Satu pola kartu: [chip tanggal/ID] [badge status] / judul / kiri-kanan / hitungan barang (expand) / tombol aksi.
   Semua halaman cukup memanggil rcCard() + rcList(); gaya ada di style.css (bagian "Card List").
   ========================================================= */
const RC_OPEN = new Set(); // key kartu yang sedang terbuka; dipertahankan saat halaman dirender ulang (filter, dll.)

// Rentang tanggal "18 Okt 2024 - 20 Okt 2024"; jika hari yang sama / salah satu kosong, tampil satu tanggal.
function rcRange(a, b) {
    if (a && b && String(a).slice(0, 10) !== String(b).slice(0, 10)) return fmtDate(a) + ' - ' + fmtDate(b);
    return fmtDate(a || b);
}

// Menentukan warna badge dari teks status bebas (status riwayat aktivitas berbentuk kode seperti 'menunggu_admin').
function statusTone(text) {
    const s = String(text || '').toLowerCase();
    if (/tolak|hilang|rusak|terlambat|late|habis|permanen|writeoff/.test(s)) return 'danger';
    if (/pending/.test(s)) return 'pink';
    if (/menunggu|waiting/.test(s)) return 'warning';
    if (/proses|dicari/.test(s)) return 'info';
    if (/dipinjam|aktif|setuju|kembali|selesai|tersedia|ditemukan|baik/.test(s)) return 'success';
    return 'muted';
}
function humanizeStatus(text) {
    return String(text == null ? '' : text).replace(/_/g, ' ').replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase());
}

/* Membuat satu kartu.
   Teks biasa (chip, title, left, right, count) otomatis di-escape.
   Properti HTML (badges, extra, detail, actions) harus sudah aman (pakai escapeHtml di pemanggil).
   o: { key, chip, badges, title, left, right, extra, main (string onclick), count, icon, detail, actions, cls } */
function rcCard(o) {
    const hasDetail = !!o.detail;
    const open = hasDetail && o.key && RC_OPEN.has(o.key);
    const foot = o.count || (hasDetail ? 'Detail' : '');
    return `<article class="rc${open ? ' open' : ''}${o.cls ? ' ' + o.cls : ''}"${o.key ? ` data-rc="${escapeHtml(o.key)}"` : ''}>
        <div class="rc-main${o.main ? ' rc-clickable' : ''}"${o.main ? ` onclick="${o.main}" onkeydown="if(event.key==='Enter')this.click()" role="button" tabindex="0"` : ''}>
            ${(o.chip || o.badges) ? `<div class="rc-top">${o.chip ? `<span class="rc-chip">${escapeHtml(o.chip)}</span>` : ''}<span class="rc-badges">${o.badges || ''}</span></div>` : ''}
            <h4 class="rc-title">${escapeHtml(o.title)}</h4>
            ${(o.left || o.right) ? `<div class="rc-meta"><span class="rc-left">${escapeHtml(o.left)}</span><span class="rc-right">${escapeHtml(o.right)}</span></div>` : ''}
            ${o.extra ? `<div class="rc-extra">${o.extra}</div>` : ''}
        </div>
        ${foot ? (hasDetail
            ? `<button type="button" class="rc-foot rc-toggle" onclick="toggleRc(this)" aria-expanded="${open}"><span class="rc-count"><i data-lucide="${o.icon || 'archive'}"></i>${escapeHtml(foot)}</span><i data-lucide="chevron-down" class="rc-chev"></i></button>`
            : `<div class="rc-foot"><span class="rc-count"><i data-lucide="${o.icon || 'archive'}"></i>${escapeHtml(foot)}</span></div>`) : ''}
        ${hasDetail ? `<div class="rc-detail">${o.detail}</div>` : ''}
        ${o.actions ? `<div class="rc-actions">${o.actions}</div>` : ''}
    </article>`;
}

// Buka/tutup detail sebuah kartu tanpa merender ulang halaman.
function toggleRc(btn) {
    const card = btn.closest('.rc');
    const open = card.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
    const key = card.dataset.rc;
    if (key) { if (open) RC_OPEN.add(key); else RC_OPEN.delete(key); }
}

// Daftar kartu, atau keadaan kosong jika tidak ada data.
function rcList(cards, emptyText) {
    return cards.length
        ? `<div class="rc-list">${cards.join('')}</div>`
        : `<div class="rc-empty"><i data-lucide="inbox"></i><p>${escapeHtml(emptyText)}</p></div>`;
}

// Judul bagian di atas daftar kartu (judul HTML + tombol aksi opsional).
function rcHead(titleHtml, actionsHtml) {
    return `<div class="rc-head"><h3>${titleHtml}</h3>${actionsHtml ? `<div class="rv-actions">${actionsHtml}</div>` : ''}</div>`;
}

// Pasangan label-nilai untuk isi detail. Nilai di-escape, kecuali dikirim sebagai {html: '...'}. Nilai kosong dilewati.
function rcFacts(pairs) {
    const rows = pairs.filter(p => p && p[1] !== undefined && p[1] !== null && p[1] !== '');
    if (!rows.length) return '';
    return `<dl class="rc-facts">${rows.map(([k, v]) =>
        `<div><dt>${escapeHtml(k)}</dt><dd>${typeof v === 'object' ? v.html : escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

// Daftar barang di dalam detail kartu. item: { name, qty, sub (HTML), action (HTML) }
function rcItemList(items) {
    return `<ul class="rc-items">${items.map(i => `<li class="rc-item">
        <span class="rc-item-name">${escapeHtml(i.name)}</span>
        <span class="rc-item-qty">${i.qty !== undefined && i.qty !== '' ? '×' + escapeHtml(i.qty) : ''}</span>
        ${i.sub ? `<span class="rc-item-sub">${i.sub}</span>` : ''}
        ${i.action ? `<span class="rc-item-action">${i.action}</span>` : ''}</li>`).join('')}</ul>`;
}

// Kartu satu baris riwayat aktivitas (dipakai Dashboard dan halaman Riwayat Aktivitas).
function activityCard(a, withTime) {
    const items = (a.items || []).filter(Boolean);
    return rcCard({
        key: 'act:' + a.id,
        chip: withTime ? fmtDateTime(a.ts) : fmtDate(a.date),
        badges: statusBadge(a.status) + (a.eventCode ? ' <span class="badge badge-info">EVENT</span>' : ''),
        title: a.title,
        left: a.who || a.user,
        right: a.ref,
        main: `showActivity('${a.id}')`,
        count: items.length ? items.length + ' Barang' : '',
        detail: rcFacts([['ID Form', a.ref], ['ID Aktivitas', a.id], ['Jenis', (COLLECTIONS[a.coll] || {}).label], ['ID Event', a.eventCode],
                         ['Aktivitas', a.action], ['Catatan', a.note]])
            + (items.length ? rcItemList(items.map(i => ({ name: i.name, qty: i.qty }))) : '')
    });
}

/* =========================================================
   DASHBOARD
   Kartu ringkasan + aktivitas 7 hari terakhir saja. Riwayat lengkap ada di menu "Riwayat Aktivitas".
   ========================================================= */
const DASHBOARD_ACTIVITY_DAYS = 7;
let dashFocus = '';        // kartu statistik yang sedang dibuka di dashboard: 'lowstock' | 'loans' | 'requests' ('' = tidak ada)
let dashFromCard = false;  // true bila halaman Data Barang dibuka lewat kartu "Jenis Barang" (menampilkan tombol kembali)

// Barang yang stoknya sudah mencapai / di bawah batas minimum (dipakai angka kartu DAN daftar detail agar selalu sama).
function dashLowStockItems(db) {
    return db.items.filter(i => i.stock <= i.minStock).sort((a, b) => a.stock - b.stock || String(a.name).localeCompare(String(b.name)));
}
// Peminjaman yang masih aktif (status 'dipinjam'), yang paling dekat jatuh tempo ditampilkan lebih dulu.
function dashActiveLoans(db) {
    return db.loans.filter(l => l.status === 'dipinjam').sort((a, b) => String(a.returnPlan || '9999').localeCompare(String(b.returnPlan || '9999')));
}
// Pengajuan pembelian yang belum diputuskan. Staff hanya melihat miliknya sendiri (sama seperti halaman Pengajuan Pembelian).
function dashPendingRequests(db) {
    const u = currentUser();
    const list = hasRole(...ROLE_ADM) ? db.requests : db.requests.filter(r => u && r.requestedBy === u.name);
    return list.filter(r => r.status === 'pending').sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// Klik kartu statistik: "Jenis Barang" membuka halaman Data Barang; kartu lain membuka/menutup daftar detail di bawahnya.
function openDashStat(key) {
    if (key === 'items') {
        dashFromCard = true;
        navigateTo('items');
        return;
    }
    dashFocus = dashFocus === key ? '' : key;
    renderPage('dashboard');
    const panel = document.getElementById('dash-detail');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Kembali ke dashboard dari halaman yang dibuka lewat kartu.
function backToDashboard() { navigateTo('dashboard'); }

// Panel daftar di bawah kartu statistik (Stok Menipis / Sedang Dipinjam / Pengajuan Menunggu).
function dashDetailHtml(key, db) {
    const kv = (label, value) => `<span>${escapeHtml(label)} <strong>${escapeHtml(value)}</strong></span>`;
    const close = `<button class="btn btn-secondary btn-sm" onclick="openDashStat('${key}')"><i data-lucide="x"></i>Tutup</button>`;
    let title, cards, empty, open;
    if (key === 'lowstock') {
        title = '<i data-lucide="alert-triangle"></i>Barang Stok Menipis';
        open = `<button class="btn btn-primary btn-sm" onclick="navigateTo('items')">Buka Data Barang</button>`;
        empty = 'Semua stok barang masih di atas batas minimum.';
        cards = dashLowStockItems(db).map(it => rcCard({
            key: 'ds:' + it.id,
            chip: it.id,
            badges: it.stock <= 0 ? '<span class="badge badge-danger">Habis</span>' : '<span class="badge badge-warning">Stok Menipis</span>',
            title: it.name,
            left: it.category || '-',
            right: [it.location, it.rack].filter(Boolean).join(' · ') || '-',
            extra: kv('Stok tersedia', it.stock + (it.unit ? ' ' + it.unit : '')) + ' &middot; ' + kv('Batas minimum', it.minStock)
        }));
    } else if (key === 'loans') {
        title = '<i data-lucide="repeat"></i>Barang Sedang Dipinjam';
        open = `<button class="btn btn-primary btn-sm" onclick="loanTab='aktif';navigateTo('loans')">Buka Peminjaman</button>`;
        empty = 'Tidak ada barang yang sedang dipinjam.';
        cards = dashActiveLoans(db).map(l => rcCard({
            key: 'dl:' + l.id,
            chip: rcRange(l.borrowDate, l.returnPlan),
            badges: loanStatusBadge('dipinjam')
                + (l.returnPlan && l.returnPlan < todayStr() ? '<span class="badge badge-danger">Terlambat</span>' : '')
                + (l.eventId ? '<span class="badge badge-purple">Event</span>' : ''),
            title: l.itemName,
            left: l.borrower,
            right: l.eventName ? 'Event: ' + l.eventName : 'ID: ' + l.itemId,
            extra: kv('Jumlah', l.qty + ' unit') + ' &middot; ' + kv('Tgl pinjam', fmtDate(l.borrowDate)) + ' &middot; ' + kv('Tgl kembali', fmtDate(l.returnPlan))
        }));
    } else {
        title = '<i data-lucide="file-text"></i>Pengajuan Menunggu Persetujuan';
        open = `<button class="btn btn-primary btn-sm" onclick="navigateTo('requests')">Buka Pengajuan Pembelian</button>`;
        empty = 'Tidak ada pengajuan yang menunggu persetujuan.';
        cards = dashPendingRequests(db).map(r => rcCard({
            key: 'dr:' + r.id,
            chip: fmtDate(r.date),
            badges: requestStatusBadge(r.status),
            title: r.itemName,
            left: r.requestedBy,
            right: r.customNo || r.id,
            extra: kv('Jumlah', r.qty + ' unit') + ' &middot; ' + kv('Tgl pengajuan', fmtDate(r.date)) + ' &middot; ' + kv('Status', 'Menunggu persetujuan')
        }));
    }
    return `<section id="dash-detail" class="dash-detail">${rcHead(title + ` <small class="text-muted">· ${cards.length} data</small>`, open + close)}
        ${rcList(cards, empty)}</section>`;
}

function renderDashboard() {
    const db = getDB();
    const lowStock = dashLowStockItems(db).length;
    const activeLoans = dashActiveLoans(db).length;
    const pendingReq = dashPendingRequests(db).length;

    const since = daysAgoStr(DASHBOARD_ACTIVITY_DAYS);
    const recent = db.activityLog
        .filter(a => String(a.date) >= since)
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, 100);

    // Kartu statistik yang bisa diklik. key = tujuan klik (lihat openDashStat), kartu terpilih diberi kelas "selected".
    const stat = (key, icon, cls, value, label) => `<div class="stat-card stat-clickable${dashFocus === key ? ' selected' : ''}"
        role="button" tabindex="0" aria-pressed="${dashFocus === key}" title="Klik untuk melihat daftar ${escapeHtml(label)}"
        onclick="openDashStat('${key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
        <div class="stat-icon ${cls}"><i data-lucide="${icon}"></i></div>
        <div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>
        <i data-lucide="${key === 'items' ? 'chevron-right' : (dashFocus === key ? 'chevron-up' : 'chevron-down')}" class="stat-go"></i></div>`;

    return `
    <div class="card-grid">
        ${stat('items', 'package', '', db.items.length, 'Jenis Barang')}
        ${stat('lowstock', 'alert-triangle', 'warning', lowStock, 'Stok Menipis')}
        ${stat('loans', 'repeat', 'success', activeLoans, 'Sedang Dipinjam')}
        ${stat('requests', 'file-text', 'purple', pendingReq, 'Pengajuan Menunggu')}
    </div>
    ${dashFocus ? dashDetailHtml(dashFocus, db) : ''}
    ${rcHead(`<i data-lucide="repeat"></i>Aktivitas ${DASHBOARD_ACTIVITY_DAYS} Hari Terakhir <small class="text-muted">· sejak ${fmtDate(since)}</small>`,
        hasRole(...ROLE_ADM) ? `<button class="btn btn-secondary btn-sm" onclick="navigateTo('history')">Lihat semua riwayat</button>` : '')}
    ${dashActivitySections(recent, db)}`;
}

// Satu kartu per event: seluruh aktivitas semua barang dalam event itu digabung (tidak dipecah per barang).
// Aktivitas yang sama pada banyak barang (mis. "dibuat") tampil sebagai satu langkah dengan jumlah barangnya.
function dashEventCard(code, logs, db) {
    const sorted = logs.slice().sort((x, y) => x.ts.localeCompare(y.ts));
    const latest = sorted[sorted.length - 1];
    const loans = db.loans.filter(l => l.eventCode === code);
    const items = loans.length
        ? loans.map(l => ({ name: l.itemName, qty: l.qty, sub: escapeHtml(humanizeStatus(l.status)) }))
        : sorted.reduce((acc, a) => acc.concat((a.items || []).filter(Boolean).map(i => ({ name: i.name, qty: i.qty }))), []);
    const steps = [], seen = {};
    sorted.forEach(a => {
        const k = a.action + '|' + a.date;
        if (!seen[k]) { seen[k] = { action: a.action, ts: a.ts, user: a.user, n: 0 }; steps.push(seen[k]); }
        seen[k].n++;
    });
    const timeline = `<h4 class="dash-step-title">Rangkaian aktivitas</h4><ul class="rv-log">${steps.map(st =>
        `<li>${fmtDateTime(st.ts)} · ${escapeHtml(humanizeStatus(st.action))} · ${escapeHtml(st.user || '-')}${st.n > 1 ? ' · ' + st.n + ' barang' : ''}</li>`).join('')}</ul>`;
    return {
        ts: latest.ts,
        html: rcCard({
            key: 'dev:' + code,
            chip: fmtDate(latest.date),
            badges: statusBadge(latest.status) + ' <span class="badge badge-info">EVENT</span>',
            title: 'Peminjaman Event: ' + (latest.event || code),
            left: latest.who || latest.user,
            right: code,
            main: `showActivity('${latest.id}')`,
            count: items.length ? items.length + ' Barang' : '',
            detail: rcFacts([['ID Event', code], ['Kegiatan', latest.event], ['Peminjam', latest.who], ['Jumlah aktivitas', String(steps.length)]])
                + timeline + (items.length ? rcItemList(items) : '')
        })
    };
}

// Riwayat aktivitas dashboard dibagi tiga kelompok yang jelas:
//   1. Peminjaman Event      : digabung per event (satu kartu = satu event, semua barangnya).
//   2. Peminjaman Reguler    : tetap per barang, tiap barang punya catatan sendiri.
//   3. Aktivitas Lainnya     : ATK, barang hilang, rusak/MT, pembelian, pengajuan.
function dashActivitySections(recent, db) {
    const eventLogs = {}, regular = [], other = [];
    recent.forEach(a => {
        if (a.coll === 'loans' && a.eventCode) (eventLogs[a.eventCode] = eventLogs[a.eventCode] || []).push(a);
        else if (a.coll === 'loans') regular.push(a);
        else other.push(a);
    });
    const eventCards = Object.keys(eventLogs).map(code => dashEventCard(code, eventLogs[code], db))
        .sort((x, y) => y.ts.localeCompare(x.ts)).map(c => c.html);
    const section = (icon, title, cards) => cards.length
        ? `<section class="dash-group"><h4 class="dash-group-title"><i data-lucide="${icon}"></i>${title} <small class="text-muted">· ${cards.length}</small></h4>${rcList(cards, '')}</section>` : '';
    const html = section('calendar-days', 'Peminjaman Event', eventCards)
        + section('package', 'Peminjaman Reguler (Per Barang)', regular.map(a => activityCard(a)))
        + section('clipboard-list', 'Aktivitas Lainnya', other.map(a => activityCard(a)));
    return html || rcList([], `Belum ada aktivitas dalam ${DASHBOARD_ACTIVITY_DAYS} hari terakhir.`);
}

/* =========================================================
   DATA BARANG (lokasi & rak terpisah, filter pencarian + kategori)
   ========================================================= */
// Daftar kategori unik dari data barang. Kategori baru otomatis muncul di filter & saran form.
function itemCategories() {
    return [...new Set(getDB().items.map(i => (i.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function filteredItems() {
    const F = filterState('items');
    return getDB().items.filter(i => (!F.cat || (i.category || '').trim() === F.cat)
        && (!F.st || i.condition === F.st)
        && queryMatches(F.q, [i.name, i.brand, i.id, i.rack, i.location, i.electronicCode]))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '') || (a.brand || '').localeCompare(b.brand || '') || (a.purchaseDate || '9').localeCompare(b.purchaseDate || '9'));
}
function renderItemsPage() {
    const canEdit = hasRole(...ROLE_ADM);
    const categories = itemCategories().map(c => [c, c]);
    const rows = filteredItems();
    return `
    <div class="page-header">
        <div>${dashFromCard ? `<button class="btn btn-secondary btn-sm" onclick="backToDashboard()"><i data-lucide="arrow-left"></i>Kembali ke Dashboard</button>` : ''}
            <p>Kelola data barang, stok, lokasi, dan rak penyimpanan.</p></div>
        ${canEdit ? `<button class="btn btn-primary" onclick="openItemForm()"><i data-lucide="plus"></i>Tambah Barang</button>` : ''}
    </div>
    <div class="filter-bar rv-filter">
        <input type="text" data-k="q" placeholder="Cari nama / ID / rak..." value="${escapeHtml(filterState('items').q)}" oninput="setFilter('items','q',this.value)">
        ${filterSelect('items', 'cat', categories, 'Semua kategori')}
        ${filterSelect('items', 'st', ITEM_CONDITIONS, 'Semua kondisi')}
        <button class="btn btn-secondary btn-sm" onclick="resetFilter('items')">Reset</button>
    </div>
    ${rcList(rows.map(it => itemCard(it, canEdit)), 'Tidak ada barang yang cocok.')}`;
}
// Kartu satu barang: badge stok (Aman / Stok Menipis / Habis Terpakai), detail lokasi-rak, dan tombol edit/hapus jika diizinkan.
function itemCard(it, canEdit) {
    const tags = [];
    if (it.electronicType === 'alat_kerja') tags.push(`<span class="badge badge-info">Elektronik: Alat Kerja${it.electronicCode ? ' &middot; ' + escapeHtml(it.electronicCode) : ''}</span>`);
    if (it.electronicType === 'alat_lain') tags.push(`<span class="badge badge-info">Elektronik: Alat Lain${it.electronicCode ? ' &middot; ' + escapeHtml(it.electronicCode) : ''}</span>`);
    if (it.isConsumable) tags.push('<span class="badge badge-warning">ATK/Habis Pakai</span>');
    let stockBadge;
    if (it.isConsumable && it.stock <= 0) stockBadge = '<span class="badge badge-danger">Habis Terpakai</span>';
    else if (it.stock <= it.minStock) stockBadge = '<span class="badge badge-danger">Stok Menipis</span>';
    else stockBadge = '<span class="badge badge-success">Aman</span>';
    return rcCard({
        key: 'item:' + it.id,
        chip: it.id,
        badges: stockBadge + ' ' + itemCondBadge(it.condition),
        title: itemFullName(it.name, it.brand),
        extra: (it.purchaseDate || it.price) ? `<span class="text-muted">${fmtDMY(it.purchaseDate)} &middot; ${it.price ? fmtRupiah(it.price) : '-'}${it.condition === 'second' && it.conditionNote ? ' &middot; Minus: ' + escapeHtml(it.conditionNote) : ''}</span>` : '',
        left: it.category || '-',
        right: [it.location, it.rack].filter(Boolean).join(' · ') || '-',
        count: 'Stok ' + it.stock + (it.unit ? ' ' + it.unit : ''),
        icon: 'package',
        detail: rcFacts([['Merk', it.brand || '-'], ['Kategori', it.category || '-'], ['Satuan', it.unit || '-'], ['Lokasi', it.location || '-'], ['Rak', it.rack || '-'], ['Stok minimum', it.minStock],
            ['Tanggal Pembelian/Input', fmtDMY(it.purchaseDate)], ['Kondisi', { html: itemCondBadge(it.condition) }],
            ['Harga Satuan', it.price ? fmtRupiah(it.price) : '-'], ['Keterangan Minus', itemMinusText(it.condition, it.conditionNote)]])
            + (tags.length ? `<div class="rc-tags">${tags.join(' ')}</div>` : ''),
        actions: canEdit ? `<button class="btn btn-sm btn-secondary" onclick="openItemForm('${it.id}')"><i data-lucide="pencil"></i>Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteItem('${it.id}')"><i data-lucide="trash-2"></i>Hapus</button>` : ''
    });
}
// Membuka form tambah/edit barang. ID barang bisa diisi sendiri saat menambah (kosong = dibuat otomatis).
function openItemForm(itemId) {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const item = itemId ? getDB().items.find(i => i.id === itemId) : null;
    const v = (field, fallback = '') => item ? escapeHtml(item[field] === undefined ? fallback : item[field]) : fallback;
    openModal(item ? 'Edit Barang' : 'Tambah Barang Baru', `
        <form id="item-form" onsubmit="submitItemForm(event, '${itemId || ''}')">
            <div class="form-group"><label>ID Barang</label>
                <input type="text" id="f-id" value="${v('id')}" placeholder="Kosongkan untuk dibuat otomatis (cth: AK0019)" ${item ? 'readonly' : ''} autocomplete="off">
                <small class="text-muted">${item ? 'ID tidak dapat diubah karena sudah dipakai di riwayat.' : 'Huruf, angka, titik, strip, atau garis bawah. Harus unik.'}</small></div>
            <div class="form-group"><label>Nama Barang</label><input type="text" id="f-name" value="${v('name')}" placeholder="cth: Laptop" required></div>
            <div class="form-group"><label>Merk / Tipe</label><input type="text" id="f-brand" value="${v('brand')}" placeholder="cth: Asus Vivobook 14"></div>
            <div class="form-row">
                <div class="form-group"><label>Kategori</label><input type="text" id="f-category" list="category-options" value="${v('category')}">
                    <datalist id="category-options">${itemCategories().map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist></div>
                <div class="form-group"><label>Satuan</label><input type="text" id="f-unit" placeholder="pcs / unit / roll" value="${v('unit')}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Stok Saat Ini</label><input type="number" id="f-stock" min="0" value="${item ? item.stock : 0}" required></div>
                <div class="form-group"><label>Stok Minimum</label><input type="number" id="f-minstock" min="0" value="${item ? item.minStock : 1}" required></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Lokasi (Gudang)</label><input type="text" id="f-location" placeholder="cth: Gudang A" value="${v('location')}" required></div>
                <div class="form-group"><label>Rak</label><input type="text" id="f-rack" placeholder="cth: Rak 2-B" value="${v('rack')}" required></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Tipe Elektronik (khusus kategori Elektronik)</label>
                    <select id="f-electype" onchange="toggleElecCodeField()">
                        <option value="" ${!item || !item.electronicType ? 'selected' : ''}>- Bukan Elektronik / Tidak Berlaku -</option>
                        <option value="alat_kerja" ${item && item.electronicType === 'alat_kerja' ? 'selected' : ''}>Alat Kerja (kode khusus)</option>
                        <option value="alat_lain" ${item && item.electronicType === 'alat_lain' ? 'selected' : ''}>Alat Lain (kode khusus)</option>
                    </select></div>
                <div class="form-group" id="f-eleccode-wrap" style="${item && item.electronicType ? '' : 'display:none;'}">
                    <label>Kode Khusus Elektronik</label>
                    <div style="display:flex;gap:6px;">
                        <input type="text" id="f-eleccode" placeholder="cth: AK-001" value="${v('electronicCode')}" style="flex:1;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="generateElecCode()">Generate</button>
                    </div></div>
            </div>
            ${itemInfoFields('f-', item ? { date: item.purchaseDate, price: item.price, condition: item.condition, note: item.conditionNote } : null)}
            <div class="form-row"><div class="form-group">
                <label><input type="checkbox" id="f-consumable" ${item && item.isConsumable ? 'checked' : ''}> Barang Habis Pakai / ATK</label>
                <p class="text-muted" style="margin-top:4px;">Aktifkan untuk barang seperti lakban, dll. yang bisa dilaporkan "Habis Pakai" dan berpotensi berstatus "Habis Terpakai".</p>
            </div></div>
            <button type="submit" class="btn btn-primary btn-block">Simpan</button>
        </form>`);
}
// Menampilkan/menyembunyikan field kode khusus elektronik sesuai tipe elektronik yang dipilih.
function toggleElecCodeField() {
    document.getElementById('f-eleccode-wrap').style.display = document.getElementById('f-electype').value ? '' : 'none';
}
// Membuatkan kode khusus otomatis (AK-xxx untuk Alat Kerja, AL-xxx untuk Alat Lain).
function generateElecCode() {
    const type = document.getElementById('f-electype').value;
    if (!type) { toast('Pilih tipe elektronik dahulu.', 'warning'); return; }
    const prefix = type === 'alat_kerja' ? 'AK' : 'AL';
    const count = getDB().items.filter(i => i.electronicType === type).length + 1;
    document.getElementById('f-eleccode').value = `${prefix}-${String(count).padStart(3, '0')}`;
}
// Menyimpan barang baru / hasil edit. ID custom divalidasi (format + unik) sebelum dipakai.
function submitItemForm(e, itemId) {
    e.preventDefault();
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const data = {
        name: fieldValue('f-name'), brand: fieldValue('f-brand'), category: fieldValue('f-category'), unit: fieldValue('f-unit'),
        stock: Number(fieldValue('f-stock')), minStock: Number(fieldValue('f-minstock')),
        location: fieldValue('f-location'), rack: fieldValue('f-rack'),
        electronicType: fieldValue('f-electype'), electronicCode: fieldValue('f-eleccode'),
        isConsumable: document.getElementById('f-consumable').checked
    };
    const info = readItemInfo('f-');
    if (info.error) { toast(info.error, 'danger'); return; }
    Object.assign(data, { purchaseDate: info.data.date, price: info.data.price, condition: info.data.condition, conditionNote: info.data.conditionNote });
    if (itemId) {
        const idx = db.items.findIndex(i => i.id === itemId);
        db.items[idx] = { ...db.items[idx], ...data };
        db.purchases.filter(p => p.itemId === itemId).forEach(p => Object.assign(p, { date: data.purchaseDate, price: data.price, condition: data.condition, conditionNote: data.conditionNote }));
        toast('Barang berhasil diperbarui.');
    } else {
        const customId = fieldValue('f-id');
        if (customId && !/^[A-Za-z0-9._-]+$/.test(customId)) { toast('ID hanya boleh berisi huruf, angka, titik, strip, dan garis bawah (tanpa spasi).', 'danger'); return; }
        if (customId && db.items.some(i => i.id.toLowerCase() === customId.toLowerCase())) { toast(`ID "${customId}" sudah dipakai barang lain.`, 'danger'); return; }
        db.items.push({ id: customId || uid('itm'), ...data });
        toast('Barang baru berhasil ditambahkan.');
    }
    saveDB(db);
    closeModal();
    renderPage('items');
    renderSidebar();
}
// Menghapus data barang setelah konfirmasi pengguna.
function deleteItem(itemId) {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    if (!confirm('Hapus barang ini? Tindakan tidak dapat dibatalkan.')) return;
    const db = getDB();
    db.items = db.items.filter(i => i.id !== itemId);
    saveDB(db);
    renderPage('items');
    toast('Barang dihapus.', 'warning');
}

/* =========================================================
   PEMINJAMAN & PENGEMBALIAN (+ form Barang Rusak/MT khusus admin)
   ========================================================= */
let loanTab = 'pinjam'; // tab yang sedang aktif di halaman Peminjaman & Pengembalian
// Membangun kerangka halaman Peminjaman & Pengembalian (tab-tab) beserta konten tab yang sedang aktif.
function renderLoansPage() {
    const db = getDB();
    const approvalCount = db.loans.filter(l => l.status === 'menunggu_admin').length;
    return `
    <div class="tabs">
        <button class="tab-btn ${loanTab === 'pinjam' ? 'active' : ''}" onclick="switchLoanTab('pinjam')">Ajukan Peminjaman</button>
        <button class="tab-btn ${loanTab === 'event' ? 'active' : ''}" onclick="switchLoanTab('event')">Peminjaman Event</button>
        <button class="tab-btn ${loanTab === 'persetujuan' ? 'active' : ''}" onclick="switchLoanTab('persetujuan')">Menunggu Persetujuan${approvalCount ? ` (${approvalCount})` : ''}</button>
        <button class="tab-btn ${loanTab === 'aktif' ? 'active' : ''}" onclick="switchLoanTab('aktif')">Sedang Dipinjam</button>
        <button class="tab-btn ${loanTab === 'riwayat' ? 'active' : ''}" onclick="switchLoanTab('riwayat')">Riwayat</button>
    </div>
    <div id="loans-tab-content">${renderLoanTabContent()}</div>`;
}
/* ---------- Halaman Pengembalian (terpisah dari Peminjaman) ---------- */
let returnTab = 'persetujuan'; // tab yang sedang aktif di halaman Pengembalian
function switchReturnTab(tab) { returnTab = tab; renderPage('returns'); }
function renderReturnsPage() {
    const db = getDB();
    const adminCount = db.loans.filter(l => l.status === 'menunggu_admin_pengembalian').length;
    return `
    <div class="tabs">
        <button class="tab-btn ${returnTab === 'persetujuan' ? 'active' : ''}" onclick="switchReturnTab('persetujuan')">Menunggu Persetujuan${adminCount ? ` (${adminCount})` : ''}</button>
        <button class="tab-btn ${returnTab === 'riwayat' ? 'active' : ''}" onclick="switchReturnTab('riwayat')">Riwayat Pengembalian</button>
        <button class="tab-btn ${returnTab === 'event' ? 'active' : ''}" onclick="switchReturnTab('event')">Riwayat Event</button>
    </div>
    <div id="returns-tab-content">${renderReturnTabContent()}</div>`;
}
// Merender konten tab halaman Pengembalian (persetujuan oleh Admin saja, atau riwayat).
function renderReturnTabContent() {
    const db = getDB();
    if (returnTab === 'event') return renderEventHistoryTab();
    if (returnTab === 'persetujuan') {
        // Semua pengajuan pengembalian (baik / bermasalah) menunggu pemeriksaan dan persetujuan Admin.
        let returnAdminList = db.loans.filter(l => l.status === 'menunggu_admin_pengembalian');
        const u = currentUser();
        if (u.role === 'staff') {
            returnAdminList = returnAdminList.filter(l => l.returnSubmittedBy === u.name);
        }
        returnAdminList = returnAdminList.sort((a, b) => new Date(b.returnSubmittedDate) - new Date(a.returnSubmittedDate));

        // Pembuat kartu antrean persetujuan; tombol Setujui/Tolak hanya muncul untuk Admin (role lain melihat status menunggu).
        const detailBtn = id => `<button class="btn btn-sm btn-secondary" onclick="viewKendalaDetail('${id}')"><i data-lucide="eye"></i>Detail</button>`;
        const stageCards = (list, c) => {
            const { groups, singles } = groupLoansByEvent(list);
            const wait = `<span class="rc-wait">Menunggu proses ${c.roleLabel}</span>`;
            const single = singles.map(l => rcCard({
                key: c.key + l.id,
                chip: fmtDate(l.returnSubmittedDate),
                badges: `<span class="badge badge-purple">${c.label}</span>`,
                title: l.itemName,
                left: l.borrower,
                right: 'Diproses oleh ' + l.returnSubmittedBy,
                extra: pendingConditionCell(l),
                count: '1 Barang',
                detail: rcItemList([{ name: l.itemName, qty: l.qty, sub: 'ID: ' + escapeHtml(l.itemId) }]),
                actions: detailBtn(l.id) + (hasRole(c.role) ? `
                    <button class="btn btn-sm btn-success" onclick="${c.approve}('${l.id}')"><i data-lucide="check"></i>Setujui</button>
                    <button class="btn btn-sm btn-danger" onclick="${c.reject}('${l.id}')"><i data-lucide="x"></i>Tolak</button>` : wait)
            }));
            const events = Object.keys(groups).map(eventId => {
                const items = groups[eventId], first = items[0];
                return rcCard({
                    key: c.key + 'evt:' + eventId,
                    chip: fmtDate(first.returnSubmittedDate),
                    badges: `<span class="badge badge-purple">Event &middot; ${c.label}</span>`,
                    title: first.eventName,
                    left: first.borrower,
                    right: 'Diproses oleh ' + first.returnSubmittedBy,
                    count: items.length + ' Barang',
                    detail: rcItemList(items.map(l => ({ name: l.itemName, qty: l.qty, sub: pendingConditionCell(l), action: detailBtn(l.id) }))),
                    actions: hasRole(c.role) ? `
                        <button class="btn btn-sm btn-success" onclick="${c.approveEvt}('${eventId}')"><i data-lucide="check"></i>Setujui Semua</button>
                        <button class="btn btn-sm btn-danger" onclick="${c.rejectEvt}('${eventId}')"><i data-lucide="x"></i>Tolak Semua</button>` : wait
                });
            });
            return single.concat(events);
        };
        const cards = stageCards(returnAdminList, { key: 'rpa:', label: 'Menunggu Pemeriksaan Admin', role: 'admin', roleLabel: 'Admin',
                approve: 'approveReturnAdmin', reject: 'rejectReturnAdmin', approveEvt: 'approveEventReturnAdmin', rejectEvt: 'rejectEventReturnAdmin' })
;
        return rcList(cards, 'Tidak ada pengajuan pengembalian yang menunggu persetujuan.');
    }
    // riwayat pengembalian: hanya peminjaman yang sudah tuntas dikembalikan (final, disetujui).
    const F = filterState('returnHistory');
    const finished = db.loans.filter(l => l.status === 'dikembalikan');
    const done = finished
        .filter(l => dateMatches(F, l.returnDate) && queryMatches(F.q, [l.code, l.returnCode, l.eventCode, l.itemId, l.itemName, l.borrower, l.eventName]))
        .sort((a, b) => new Date(b.returnDate) - new Date(a.returnDate));
    return `
    ${filterBar('returnHistory', { placeholder: 'Cari ID Form / ID Barang / barang / peminjam', years: yearOptions(finished.map(l => l.returnDate)) })}
    ${rcList(done.map(l => rcCard({
        key: 'rh:' + l.id,
        chip: fmtDate(l.returnDate),
        badges: historyConditionCell(l),
        title: l.itemName,
        left: l.borrower,
        right: l.returnCode || l.code || '-',
        extra: l.eventName ? `<span class="badge badge-purple">Event: ${escapeHtml(l.eventName)}</span>` : '',
        count: '1 Barang',
        detail: rcItemList([{ name: l.itemName, qty: l.qty, sub: 'ID: ' + escapeHtml(l.itemId) }])
            + rcFacts([['ID Form', l.returnCode || l.code || '-'], ['Tanggal kembali', fmtDate(l.returnDate)], ['Kronologi / catatan', l.returnNotes || '-'],
                       ['Diproses oleh', l.processedBy || '-'],
                       ['Disetujui oleh', l.returnApprovedBy || '-']]),
        actions: Array.isArray(l.issues) && l.issues.length ? `<button class="btn btn-sm btn-secondary" onclick="viewKendalaDetail('${l.id}')"><i data-lucide="eye"></i>Detail</button>` : ''
    })), 'Tidak ada riwayat pengembalian.')}`;
}
// Mengganti tab aktif pada halaman Peminjaman lalu merender ulang halamannya.
function switchLoanTab(tab) { loanTab = tab; renderPage('loans'); }
// Merender konten sesuai tab peminjaman yang aktif saat ini (pinjam/event/persetujuan/aktif/riwayat).
function renderLoanTabContent() {
    const db = getDB();
    if (loanTab === 'pinjam') {
        const options = db.items.filter(i => i.stock > 0);
        loanItemPickCache = options; // simpan untuk dipakai fungsi pencarian
        loanPicked = {}; loanShown = [];
        return `
        <div class="table-container">
            <div class="modal-body">
                <form id="loan-form" onsubmit="submitLoanForm(event)">
                    <div class="form-group"><label>Cari Barang <small class="text-muted">(ketik, mis. "laptop", lalu centang beberapa barang sekaligus)</small></label>
                        <div class="ev-item-search-wrap">
                            <input type="text" id="loan-item-search" placeholder="${options.length ? 'Cari nama, merk, kondisi, atau ID barang...' : 'Tidak ada barang tersedia'}" autocomplete="off" ${options.length ? '' : 'disabled'}
                                oninput="onLoanItemSearchInput()" onfocus="onLoanItemSearchInput()" onblur="hideLoanItemDropdownDelayed()">
                            <div class="ev-item-dropdown hidden" id="loan-item-dropdown"></div>
                        </div>
                    </div>
                    <div class="form-group"><label>Barang Dipilih <span class="badge badge-info" id="loan-picked-count">0 barang · 0 unit</span></label>
                        <div id="loan-picked"><div class="text-muted">Belum ada barang dipilih.</div></div>
                    </div>
                    <div class="form-group"><label>Nama User / PIC Peminjaman (penanggung jawab)</label><input type="text" id="loan-borrower" value="${escapeHtml(currentUser().name)}" required></div>
                    <div class="form-row">
                        <div class="form-group"><label>Tanggal Pinjam</label><input type="date" id="loan-date" value="${todayStr()}" required></div>
                        <div class="form-group"><label>Rencana Kembali</label><input type="date" id="loan-return-plan" required></div>
                    </div>
                    <div class="form-group"><label>Keperluan / Catatan</label><textarea id="loan-notes" placeholder="cth: untuk perbaikan mesin di lokasi X"></textarea></div>
                    <p class="text-muted" style="margin-bottom:12px;">Pengajuan ini akan diproses menunggu persetujuan Admin sebelum barang boleh diambil.</p>
                    <button type="submit" class="btn btn-primary">Ajukan Peminjaman</button>
                </form>
            </div>
        </div>`;
    }
    if (loanTab === 'event') {
        return renderEventLoanForm();
    }
    if (loanTab === 'persetujuan') {
        // Tab ini HANYA berisi pengajuan PEMINJAMAN baru (menunggu Admin).
        // Pengajuan PENGEMBALIAN diproses terpisah di halaman "Pengembalian".
        const u = currentUser();
        let loanList = db.loans.filter(l => l.status === 'menunggu_admin');
        if (u.role === 'staff') {
            loanList = loanList.filter(l => l.requestedBy === u.name);
        }
        loanList = loanList.sort((a, b) => new Date(b.borrowDate) - new Date(a.borrowDate));

        const wait = '<span class="rc-wait">Menunggu proses Admin</span>';
        const { groups: loanGroups, singles: loanSingles } = groupLoansByEvent(loanList);
        const cards = loanSingles.map(l => rcCard({
            key: 'lp:' + l.id,
            chip: rcRange(l.borrowDate, l.returnPlan),
            badges: loanStatusBadge(l.status),
            title: l.itemName,
            left: l.borrower,
            right: 'Diajukan oleh ' + l.requestedBy,
            count: '1 Barang',
            detail: rcItemList([{ name: l.itemName, qty: l.qty, sub: 'ID: ' + escapeHtml(l.itemId) }])
                + rcFacts([['Tanggal pinjam', fmtDate(l.borrowDate)], ['Rencana kembali', fmtDate(l.returnPlan)], ['Keperluan / catatan', l.notes]]),
            actions: hasRole('admin') ? `
                <button class="btn btn-sm btn-success" onclick="approveLoanStage('${l.id}','admin')"><i data-lucide="check"></i>Setujui</button>
                <button class="btn btn-sm btn-danger" onclick="rejectLoan('${l.id}')"><i data-lucide="x"></i>Tolak</button>` : wait
        })).concat(Object.keys(loanGroups).map(eventId => {
            const items = loanGroups[eventId], first = items[0];
            return rcCard({
                key: 'lp:evt:' + eventId,
                chip: rcRange(first.borrowDate, first.returnPlan),
                badges: '<span class="badge badge-purple">Event</span>' + loanStatusBadge(first.status),
                title: first.eventName,
                left: first.borrower,
                right: first.eventLocation || 'Diajukan oleh ' + first.requestedBy,
                count: items.length + ' Barang',
                detail: rcItemList(items.map(l => ({ name: l.itemName, qty: l.qty, sub: 'ID: ' + escapeHtml(l.itemId) })))
                    + rcFacts([['Diajukan oleh', first.requestedBy], ['Tanggal pinjam', fmtDate(first.borrowDate)], ['Rencana kembali', fmtDate(first.returnPlan)], ['Keperluan / catatan', first.notes]]),
                actions: hasRole('admin') ? `
                    <button class="btn btn-sm btn-success" onclick="approveEventLoan('${eventId}')"><i data-lucide="check"></i>Setujui Semua</button>
                    <button class="btn btn-sm btn-danger" onclick="rejectEventLoan('${eventId}')"><i data-lucide="x"></i>Tolak Semua</button>` : wait
            });
        }));
        return rcList(cards, 'Tidak ada pengajuan peminjaman yang menunggu persetujuan.');
    }
    if (loanTab === 'aktif') {
        const active = db.loans.filter(l => l.status === 'dipinjam');
        const { groups: activeGroups, singles: activeSingles } = groupLoansByEvent(active);
        // Tanda "Terlambat" hanya tampilan: rencana kembali sudah lewat dari hari ini.
        const activeBadges = l => loanStatusBadge('dipinjam') + (l.returnPlan && l.returnPlan < todayStr() ? '<span class="badge badge-danger">Terlambat</span>' : '');
        const cards = activeSingles.map(l => rcCard({
            key: 'la:' + l.id,
            chip: rcRange(l.borrowDate, l.returnPlan),
            badges: activeBadges(l),
            title: l.itemName,
            left: l.borrower,
            right: 'Disetujui oleh ' + (l.adminApprovedBy || '-'),
            count: '1 Barang',
            detail: rcItemList([{ name: l.itemName, qty: l.qty, sub: 'ID: ' + escapeHtml(l.itemId) }])
                + rcFacts([['Tanggal pinjam', fmtDate(l.borrowDate)], ['Rencana kembali', fmtDate(l.returnPlan)], ['Keperluan / catatan', l.notes]]),
            actions: `<button class="btn btn-sm btn-secondary" onclick="printSingleLoan('${l.id}')"><i data-lucide="printer"></i>Print</button>`
                + (hasRole(...ROLE_ADM) ? `<button class="btn btn-sm btn-success" onclick="openReturnForm('${l.id}')"><i data-lucide="corner-down-left"></i>Proses Pengembalian</button>` : '')
        })).concat(Object.keys(activeGroups).map(eventId => {
            const items = activeGroups[eventId], first = items[0];
            return rcCard({
                key: 'la:evt:' + eventId,
                chip: rcRange(first.borrowDate, first.returnPlan),
                badges: '<span class="badge badge-purple">Event</span>' + activeBadges(first),
                title: first.eventName,
                left: first.borrower,
                right: first.eventLocation || 'Disetujui oleh ' + (first.adminApprovedBy || '-'),
                count: items.length + ' Barang',
                detail: rcItemList(items.map(l => ({ name: l.itemName, qty: l.qty, sub: 'ID: ' + escapeHtml(l.itemId) })))
                    + rcFacts([['Disetujui oleh', first.adminApprovedBy || '-'], ['Tanggal pinjam', fmtDate(first.borrowDate)], ['Rencana kembali', fmtDate(first.returnPlan)], ['Keperluan / catatan', first.notes]]),
                actions: `<button class="btn btn-sm btn-secondary" onclick="printEventLoan('${eventId}')"><i data-lucide="printer"></i>Print</button>`
                    + (hasRole(...ROLE_ADM) ? `<button class="btn btn-sm btn-success" onclick="openEventReturnForm('${eventId}')"><i data-lucide="corner-down-left"></i>Proses Pengembalian Event</button>` : '')
            });
        }));
        return rcList(cards, 'Tidak ada peminjaman aktif.');
    }
    // riwayat: khusus riwayat PENGAJUAN PEMINJAMAN yang ditolak Admin (bukan barang yang sudah
    // selesai dikembalikan - itu ada di Riwayat Pengembalian pada halaman "Pengembalian").
    const F = filterState('loanHistory');
    const rejected = db.loans.filter(l => l.status === 'ditolak');
    const done = rejected
        .filter(l => dateMatches(F, l.rejectedDate || l.borrowDate) && queryMatches(F.q, [l.code, l.eventCode, l.itemId, l.itemName, l.borrower, l.eventName, l.rejectedBy]))
        .sort((a, b) => new Date(b.rejectedDate) - new Date(a.rejectedDate));
    return `
    ${filterBar('loanHistory', { placeholder: 'Cari ID Form / ID Barang / barang / peminjam', years: yearOptions(rejected.map(l => l.rejectedDate || l.borrowDate)) })}
    <p class="text-muted" style="margin-bottom:12px;">Riwayat pengajuan peminjaman yang ditolak. Riwayat barang yang sudah selesai dikembalikan ada di halaman <strong>Pengembalian</strong>.</p>
    ${rcList(done.map(l => rcCard({
        key: 'lh:' + l.id,
        chip: fmtDate(l.borrowDate),
        badges: '<span class="badge badge-danger">Ditolak</span>',
        title: l.itemName,
        left: l.borrower,
        right: l.code || '-',
        extra: l.eventName ? `<span class="badge badge-purple">Event: ${escapeHtml(l.eventName)}</span>` : '',
        count: '1 Barang',
        detail: rcItemList([{ name: l.itemName, qty: l.qty, sub: 'ID: ' + escapeHtml(l.itemId) }])
            + rcFacts([['ID Form', l.code || '-'], ['Ditolak oleh', l.rejectedBy || '-'], ['Alasan penolakan', l.rejectReason]])
    })), 'Tidak ada riwayat penolakan peminjaman.')}`;
}
// Memetakan status peminjaman menjadi label badge berwarna untuk ditampilkan di tabel.
function loanStatusBadge(status) {
    if (status === 'menunggu_admin') return '<span class="badge badge-warning">Menunggu Admin</span>';
    if (status === 'menunggu_admin_pengembalian') return '<span class="badge badge-warning">Menunggu Admin (Pengembalian)</span>';
    if (status === 'dipinjam') return '<span class="badge badge-success">Aktif</span>';
    if (status === 'ditolak') return '<span class="badge badge-danger">Ditolak</span>';
    return '-';
}
// Memetakan kondisi barang saat dikembalikan (baik/rusak/mt/hilang) menjadi label badge berwarna.
function conditionBadge(cond) {
    if (cond === 'baik') return '<span class="badge badge-success">Baik</span>';
    if (cond === 'rusak') return '<span class="badge badge-danger">Rusak</span>';
    if (cond === 'mt') return '<span class="badge badge-warning">Perlu Maintenance</span>';
    if (cond === 'hilang') return '<span class="badge badge-danger">Hilang</span>';
    if (cond === 'habis_pakai') return '<span class="badge badge-info">Habis Pakai</span>';
    if (cond === 'campuran') return '<span class="badge badge-purple">Beberapa Kendala</span>';
    return '-';
}
// Mengajukan peminjaman 1 jenis barang. Status menjadi 'menunggu_admin'; stok BELUM dikurangi
// di sini, baru dikurangi setelah disetujui Admin lewat approveLoanStage().
/* ---------- Pencarian barang (autocomplete) untuk "Pilih Barang" di form Peminjaman biasa ---------- */
let loanItemPickCache = []; // daftar barang berstok (di-set ulang tiap kali tab "pinjam" dirender)
let loanPicked = {};  // barang yang dicentang di form Peminjaman biasa: { itemId: jumlah }
let loanShown = [];   // hasil pencarian yang sedang tampil di dropdown
// Menyaring daftar barang sesuai kata kunci (nama, merk, kondisi, ID), lalu menampilkannya di dropdown.
function onLoanItemSearchInput() {
    const input = document.getElementById('loan-item-search');
    if (!input) return;
    const query = input.value.trim().toLowerCase();
    const filtered = query
        ? loanItemPickCache.filter(i => itemLabel(i).toLowerCase().includes(query) || i.id.toLowerCase().includes(query))
        : loanItemPickCache;
    renderLoanItemDropdown(filtered.slice(0, 100));
}
// Dropdown pencarian: klik barang untuk mencentang/melepas (dropdown tetap terbuka), atau pilih semua hasil sekaligus.
function renderLoanItemDropdown(items) {
    const dropdown = document.getElementById('loan-item-dropdown');
    if (!dropdown) return;
    loanShown = items;
    const keep = dropdown.scrollTop;
    if (!items.length) {
        dropdown.innerHTML = `<div class="ev-item-dropdown-empty">Barang tidak ditemukan.</div>`;
    } else {
        const allOn = items.every(i => loanPicked[i.id]);
        dropdown.innerHTML = `<div class="ev-item-dropdown-actions">
                <button type="button" onmousedown="event.preventDefault(); loanPickAll()">${allOn ? 'Lepas semua hasil' : 'Pilih semua hasil (' + items.length + ')'}</button>
                <button type="button" onmousedown="event.preventDefault(); loanClearPicked()">Kosongkan pilihan</button></div>`
            + items.map(i => `
            <div class="ev-item-dropdown-item${loanPicked[i.id] ? ' picked' : ''}" onmousedown="event.preventDefault(); toggleLoanPick('${i.id}')">
                <span class="ev-item-dropdown-name"><span class="ev-check">${loanPicked[i.id] ? '&#9745;' : '&#9744;'}</span> ${escapeHtml(itemLabel(i))}</span>
                <span class="ev-item-dropdown-meta">[${escapeHtml(i.id)}] &middot; stok: ${i.stock} ${escapeHtml(i.unit || '')}${itemMinusMeta(i)}</span>
            </div>`).join('');
    }
    dropdown.scrollTop = keep;
    dropdown.classList.remove('hidden');
}
function refreshLoanPicker() {
    renderLoanItemDropdown(loanShown);
    renderLoanPicked();
}
// Mencentang / melepas satu barang.
function toggleLoanPick(itemId) {
    if (loanPicked[itemId]) delete loanPicked[itemId]; else loanPicked[itemId] = 1;
    refreshLoanPicker();
}
// Mencentang semua hasil pencarian (atau melepas semuanya bila sudah tercentang semua).
function loanPickAll() {
    const allOn = loanShown.every(i => loanPicked[i.id]);
    loanShown.forEach(i => { if (allOn) delete loanPicked[i.id]; else if (!loanPicked[i.id]) loanPicked[i.id] = 1; });
    refreshLoanPicker();
}
function loanClearPicked() { loanPicked = {}; refreshLoanPicker(); }
function setLoanPickQty(itemId, value) {
    const item = loanItemPickCache.find(i => i.id === itemId);
    if (!item || !loanPicked[itemId]) return;
    loanPicked[itemId] = Math.max(1, Math.min(item.stock, Math.floor(Number(value)) || 1));
    renderLoanPicked();
}
// Daftar "Barang Dipilih" dengan jumlah per barang.
function renderLoanPicked() {
    const wrap = document.getElementById('loan-picked');
    if (!wrap) return;
    const ids = Object.keys(loanPicked);
    const units = ids.reduce((n, id) => n + loanPicked[id], 0);
    document.getElementById('loan-picked-count').textContent = `${ids.length} barang · ${units} unit`;
    wrap.innerHTML = ids.length ? ids.map(id => {
        const i = loanItemPickCache.find(x => x.id === id);
        if (!i) return '';
        return `<div class="loan-picked-row">
            <div class="lp-name">${escapeHtml(itemLabel(i))}<small class="text-muted">[${escapeHtml(i.id)}] stok: ${i.stock} ${escapeHtml(i.unit || '')}</small></div>
            <input type="number" min="1" max="${i.stock}" value="${loanPicked[id]}" onchange="setLoanPickQty('${id}', this.value)" title="Jumlah dipinjam">
            <button type="button" class="btn-icon text-danger" title="Hapus" onclick="toggleLoanPick('${id}')"><i data-lucide="trash-2"></i></button></div>`;
    }).join('') : '<div class="text-muted">Belum ada barang dipilih.</div>';
    if (window.lucide) lucide.createIcons();
}
// Menyembunyikan dropdown saran barang untuk "Pilih Barang" di form Peminjaman biasa.
function hideLoanItemDropdown() {
    const dropdown = document.getElementById('loan-item-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
}
// Menyembunyikan dropdown dengan sedikit delay, supaya klik pada item dropdown tetap sempat diproses sebelum blur.
function hideLoanItemDropdownDelayed() {
    setTimeout(hideLoanItemDropdown, 150);
}
function submitLoanForm(e) {
    e.preventDefault();
    const db = getDB();
    const ids = Object.keys(loanPicked);
    if (!ids.length) { toast('Pilih minimal 1 barang dari daftar pencarian.', 'danger'); return; }
    // Validasi semua dulu agar tidak ada yang tersimpan setengah.
    const picks = [];
    for (const itemId of ids) {
        const item = db.items.find(i => i.id === itemId);
        const qty = Number(loanPicked[itemId]);
        if (!item) { toast('Ada barang yang sudah tidak tersedia. Pilih ulang.', 'danger'); return; }
        if (!(qty >= 1) || qty > item.stock) { toast(`Jumlah "${itemLabel(item)}" melebihi stok tersedia.`, 'danger'); return; }
        picks.push({ item, qty });
    }
    const common = {
        borrower: document.getElementById('loan-borrower').value.trim(),
        borrowDate: document.getElementById('loan-date').value,
        returnPlan: document.getElementById('loan-return-plan').value,
        notes: document.getElementById('loan-notes').value.trim(),
        status: 'menunggu_admin', requestedBy: currentUser().name
    };
    // Stok BELUM dikurangi di sini - baru dikurangi setelah disetujui Admin
    picks.forEach(({ item, qty }) => db.loans.push(Object.assign({ id: uid('loan'), itemId: item.id, itemName: itemLabel(item), qty }, common)));
    saveDB(db);
    toast(picks.length > 1 ? `${picks.length} barang berhasil diajukan, menunggu persetujuan Admin.` : 'Peminjaman berhasil diajukan, menunggu persetujuan Admin.');
    switchLoanTab('persetujuan');
    renderSidebar();
}
/* ---------- Form Peminjaman Event (banyak barang sekaligus) ----------
   Semua barang yang dipilih di form ini digabung dalam satu "paket" (eventId)
   sehingga diajukan, disetujui, ditolak, dan dikembalikan bersama-sama sebagai
   satu kesatuan, tanpa perlu memproses satu per satu untuk tiap barang. */
let eventItemRowSeq = 0; // penghitung untuk membuat id unik tiap baris barang di form Peminjaman Event
let eventLoanItemsCache = null; // cache daftar barang berstok agar tidak query berulang saat mengetik di pencarian
// Mengambil (dan menyimpan sementara/cache) daftar barang dengan stok > 0 untuk kotak pencarian
// pada form Peminjaman Event, supaya tidak query database berulang kali saat mengetik.
function getEventLoanItems() {
    if (!eventLoanItemsCache) {
        const db = getDB();
        eventLoanItemsCache = db.items.filter(i => i.stock > 0);
    }
    return eventLoanItemsCache;
}
// Membangun HTML form 'Peminjaman Event' (peminjaman banyak barang sekaligus dalam satu paket).
function renderEventLoanForm() {
    eventLoanItemsCache = null; // refresh cache stok setiap kali form dibuka
    return `
    <div class="table-container">
        <div class="modal-body">
            <p class="text-muted" style="margin-bottom:16px;">Gunakan form ini untuk mengajukan peminjaman banyak barang sekaligus untuk keperluan event/acara. Seluruh barang akan diajukan, disetujui, dan dikembalikan sebagai satu paket.</p>
            <form id="event-loan-form" onsubmit="submitEventLoanForm(event)">
                <div class="form-row">
                    <div class="form-group"><label>Nama Event / Acara</label><input type="text" id="event-name" placeholder="cth: Wedding Ibu Sari - Ballroom Hotel X" required></div>
                    <div class="form-group"><label>Nama User / PIC Event (penanggung jawab)</label><input type="text" id="event-borrower" value="${escapeHtml(currentUser().name)}" required></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Lokasi Event (opsional)</label><input type="text" id="event-location" placeholder="cth: Hotel X, Jakarta"></div>
                    <div class="form-group"><label>Tanggal Pinjam</label><input type="date" id="event-date" value="${todayStr()}" required></div>
                </div>
                <div class="form-group"><label>Rencana Kembali</label><input type="date" id="event-return-plan" required></div>
                <div class="form-group"><label>Catatan Umum (opsional)</label><textarea id="event-notes" placeholder="catatan tambahan untuk event ini"></textarea></div>

                <div class="form-group">
                    <label>Daftar Barang yang Dipinjam <span class="badge badge-info" id="event-items-count">0 jenis · 0 unit</span></label>
                    <div id="event-items-wrap"></div>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="addEventItemRow()" style="margin-top:6px;"><i data-lucide="plus"></i>Tambah Barang</button>
                </div>
                <p class="text-muted" style="margin:12px 0;">Pengajuan ini akan diproses sebagai satu paket, menunggu persetujuan Admin sebelum seluruh barang boleh diambil.</p>
                <button type="submit" class="btn btn-primary">Ajukan Peminjaman Event</button>
            </form>
        </div>
    </div>`;
}
// Menambahkan satu baris input barang baru (pencarian + jumlah) ke form Peminjaman Event.
function addEventItemRow() {
    const wrap = document.getElementById('event-items-wrap');
    if (!wrap) return;
    const rowId = 'evrow-' + (++eventItemRowSeq);
    const hasItems = getEventLoanItems().length > 0;
    const div = document.createElement('div');
    div.className = 'event-item-row';
    div.id = rowId;
    div.innerHTML = `
        <div class="ev-item-search-wrap">
            <input type="text" class="ev-item-search" placeholder="${hasItems ? 'Cari nama atau ID barang...' : 'Tidak ada barang tersedia'}" autocomplete="off" ${hasItems ? '' : 'disabled'}
                oninput="onEventItemSearchInput('${rowId}', true)" onfocus="onEventItemSearchInput('${rowId}')" onblur="hideEventItemDropdownDelayed('${rowId}')">
            <input type="hidden" class="ev-item-select" value="">
            <div class="ev-item-dropdown hidden" id="${rowId}-dropdown"></div>
        </div>
        <input type="number" class="ev-item-qty" min="1" value="1" oninput="updateEventItemSummary()" required>
        <button type="button" class="btn-icon text-danger" title="Hapus barang ini" onclick="removeEventItemRow('${rowId}')"><i data-lucide="trash-2"></i></button>
    `;
    wrap.appendChild(div);
    if (window.lucide) lucide.createIcons();
    updateEventItemSummary();
    return rowId;
}
// Menghapus satu baris input barang dari form Peminjaman Event.
function removeEventItemRow(rowId) {
    const el = document.getElementById(rowId);
    if (el) el.remove();
    updateEventItemSummary();
}
/* ---------- Pencarian barang (autocomplete) untuk baris Peminjaman Event ---------- */
// ID barang yang sudah dipilih di baris lain (kecuali baris exceptRowId) pada form Peminjaman Event.
function pickedEventItemIds(exceptRowId) {
    const ids = new Set();
    document.querySelectorAll('#event-items-wrap .event-item-row').forEach(row => {
        const id = row.querySelector('.ev-item-select').value;
        if (row.id !== exceptRowId && id) ids.add(id);
    });
    return ids;
}
// Memperbarui ringkasan di sebelah label "Daftar Barang yang Dipinjam": jumlah jenis & total unit.
function updateEventItemSummary() {
    const label = document.getElementById('event-items-count');
    if (!label) return;
    let types = 0, units = 0;
    document.querySelectorAll('#event-items-wrap .event-item-row').forEach(row => {
        if (!row.querySelector('.ev-item-select').value) return;
        types++;
        units += Number(row.querySelector('.ev-item-qty').value) || 0;
    });
    label.textContent = `${types} jenis · ${units} unit`;
}
// Menyaring saran barang sesuai kata kunci. Barang yang sudah masuk daftar (di baris lain) disembunyikan,
// tetapi tetap muncul lagi di peminjaman baru karena daftar dihitung per form.
// clearSelection=true saat user mengetik: pilihan lama dilepas sampai user memilih dari dropdown lagi.
function onEventItemSearchInput(rowId, clearSelection) {
    const row = document.getElementById(rowId);
    if (!row) return;
    if (clearSelection) { row.querySelector('.ev-item-select').value = ''; updateEventItemSummary(); }
    const query = row.querySelector('.ev-item-search').value.trim().toLowerCase();
    const taken = pickedEventItemIds(rowId);
    const filtered = getEventLoanItems().filter(i => !taken.has(i.id)
        && (!query || itemLabel(i).toLowerCase().includes(query) || i.id.toLowerCase().includes(query)));
    renderEventItemDropdown(rowId, filtered.slice(0, 50));
}
// Merender daftar dropdown saran barang (autocomplete) untuk satu baris tertentu pada form Peminjaman Event.
function renderEventItemDropdown(rowId, items) {
    const dropdown = document.getElementById(rowId + '-dropdown');
    if (!dropdown) return;
    if (!items.length) {
        dropdown.innerHTML = `<div class="ev-item-dropdown-empty">Barang tidak ditemukan.</div>`;
    } else {
        dropdown.innerHTML = `<div class="ev-item-dropdown-actions"><button type="button" onmousedown="event.preventDefault(); addAllEventItems('${rowId}')">Tambahkan semua hasil (${items.length})</button></div>` + items.map(i => `
            <div class="ev-item-dropdown-item" onmousedown="event.preventDefault(); selectEventItemFromDropdown('${rowId}', '${i.id}')">
                <span class="ev-item-dropdown-name">${escapeHtml(itemLabel(i))}</span>
                <span class="ev-item-dropdown-meta">[${escapeHtml(i.id)}] &middot; stok: ${i.stock} ${escapeHtml(i.unit || '')}${itemMinusMeta(i)}</span>
            </div>`).join('');
    }
    dropdown.classList.remove('hidden');
}
// Menambahkan semua hasil pencarian ke daftar event sekaligus (satu baris per barang, jumlah awal 1).
function addAllEventItems(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const query = row.querySelector('.ev-item-search').value.trim().toLowerCase();
    const taken = pickedEventItemIds(rowId);
    const items = getEventLoanItems().filter(i => !taken.has(i.id)
        && (!query || itemLabel(i).toLowerCase().includes(query) || i.id.toLowerCase().includes(query))).slice(0, 100);
    items.forEach((it, n) => {
        const target = (n === 0 && !row.querySelector('.ev-item-select').value) ? rowId : addEventItemRow();
        selectEventItemFromDropdown(target, it.id);
    });
}
// Mengisi baris form Peminjaman Event dengan barang yang dipilih dari dropdown, lalu menyembunyikan dropdown.
function selectEventItemFromDropdown(rowId, itemId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const item = getEventLoanItems().find(i => i.id === itemId);
    if (!item) return;
    row.querySelector('.ev-item-select').value = item.id;
    row.querySelector('.ev-item-search').value = `[${item.id}] ${itemLabel(item)} (stok: ${item.stock} ${item.unit || ''})`;
    hideEventItemDropdown(rowId);
    updateEventItemSummary();
}
// Menyembunyikan dropdown saran barang untuk satu baris tertentu.
function hideEventItemDropdown(rowId) {
    const dropdown = document.getElementById(rowId + '-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
}
// Menyembunyikan dropdown dengan sedikit delay, supaya event klik/mousedown pada item dropdown
// (yang terjadi sebelum blur) tetap sempat diproses terlebih dahulu.
function hideEventItemDropdownDelayed(rowId) {
    setTimeout(() => hideEventItemDropdown(rowId), 150);
}
// Mengajukan peminjaman event: menggabungkan jumlah bila ada barang yang sama dipilih di beberapa baris,
// memvalidasi stok tiap barang, lalu membuat satu record peminjaman per barang yang ditandai eventId yang sama.
function submitEventLoanForm(e) {
    e.preventDefault();
    const db = getDB();
    const eventName = document.getElementById('event-name').value.trim();
    const borrower = document.getElementById('event-borrower').value.trim();
    const location = document.getElementById('event-location').value.trim();
    const borrowDate = document.getElementById('event-date').value;
    const returnPlan = document.getElementById('event-return-plan').value;
    const notes = document.getElementById('event-notes').value.trim();

    const rows = Array.from(document.querySelectorAll('#event-items-wrap .event-item-row'));
    if (!rows.length) { toast('Tambahkan minimal 1 barang untuk peminjaman event ini.', 'danger'); return; }

    // Gabungkan jumlah jika barang yang sama dipilih di lebih dari satu baris
    const picked = {};
    for (const row of rows) {
        const itemId = row.querySelector('.ev-item-select').value;
        const qty = Number(row.querySelector('.ev-item-qty').value);
        if (!itemId) { toast('Pilih barang pada setiap baris yang ditambahkan.', 'danger'); return; }
        if (!qty || qty < 1) { toast('Jumlah barang harus lebih dari 0.', 'danger'); return; }
        picked[itemId] = (picked[itemId] || 0) + qty;
    }
    for (const itemId in picked) {
        const item = db.items.find(i => i.id === itemId);
        if (!item || picked[itemId] > item.stock) {
            toast(`Jumlah "${item ? itemLabel(item) : itemId}" melebihi stok tersedia.`, 'danger');
            return;
        }
    }

    const eventId = uid('event');
    Object.keys(picked).forEach(itemId => {
        const item = db.items.find(i => i.id === itemId);
        db.loans.push({
            id: uid('loan'), itemId, itemName: itemLabel(item), qty: picked[itemId],
            borrower, borrowDate, returnPlan, notes,
            status: 'menunggu_admin', requestedBy: currentUser().name,
            eventId, eventName, eventLocation: location
        });
    });
    saveDB(db);
    toast(`Peminjaman event "${eventName}" berhasil diajukan (${Object.keys(picked).length} jenis barang), menunggu persetujuan Admin.`);
    switchLoanTab('persetujuan');
    renderSidebar();
}
// Memisahkan daftar peminjaman menjadi kelompok paket event (dikelompokkan berdasarkan eventId)
// dan peminjaman satuan (bukan bagian dari event).
function groupLoansByEvent(list) {
    const groups = {};
    const singles = [];
    list.forEach(l => {
        if (l.eventId) {
            if (!groups[l.eventId]) groups[l.eventId] = [];
            groups[l.eventId].push(l);
        } else {
            singles.push(l);
        }
    });
    return { groups, singles };
}
// Data form peminjaman untuk peminjaman yang sedang berjalan (satuan atau satu paket event).
function activeLoanFormModel(loans) {
    const first = loans[0];
    return {
        eventName: first.eventName, eventLocation: first.eventLocation, borrowDate: first.borrowDate, returnDate: first.returnPlan,
        peminjam: first.borrower, adminName: first.adminApprovedBy,
        items: loans.map(l => ({ itemId: l.itemId, itemName: l.itemName, qty: l.qty }))
    };
}
// Cetak form peminjaman barang untuk 1 peminjaman satuan (bukan bagian dari event).
function printSingleLoan(loanId) {
    const loan = getDB().loans.find(l => l.id === loanId && l.status === 'dipinjam');
    if (!loan) return;
    printHtml(`<div class="form-doc">${buildLoanFormHtml(activeLoanFormModel([loan]), { signatures: true })}</div>`);
}
// Cetak form peminjaman barang untuk 1 paket peminjaman Event (banyak barang sekaligus).
function printEventLoan(eventId) {
    const loans = getDB().loans.filter(l => l.eventId === eventId && l.status === 'dipinjam');
    if (!loans.length) return;
    printHtml(`<div class="form-doc">${buildLoanFormHtml(activeLoanFormModel(loans), { signatures: true })}</div>`);
}
// Persetujuan 1 tahap: cukup Admin. Stok langsung dipotong setelah Admin menyetujui.
function approveLoanStage(loanId, stage) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    if (stage === 'admin') {
        if (loan.status !== 'menunggu_admin') return;
        const item = db.items.find(i => i.id === loan.itemId);
        if (!item || item.stock < loan.qty) {
            toast('Stok tidak lagi mencukupi. Peminjaman tidak dapat disetujui.', 'danger');
            return;
        }
        item.stock -= loan.qty;
        loan.status = 'dipinjam';
        loan.adminApprovedBy = currentUser().name;
        loan.adminApprovedDate = todayStr();
        saveDB(db);
        toast('Peminjaman disetujui Admin. Stok diperbarui, barang siap diambil.');
    }
    renderPage('loans');
    renderSidebar();
}
// Admin menolak satu pengajuan peminjaman, dengan alasan opsional.
function rejectLoan(loanId) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    const reason = prompt('Alasan penolakan (opsional):', '') || '';
    loan.status = 'ditolak';
    loan.rejectedBy = currentUser().name;
    loan.rejectedDate = todayStr();
    loan.rejectReason = reason.trim();
    saveDB(db);
    toast('Pengajuan peminjaman ditolak.', 'warning');
    renderPage('loans');
    renderSidebar();
}
/* ---------- Form Pengembalian (alur baru) ----------
   1) Diajukan (status -> menunggu_admin_pengembalian) untuk SEMUA kondisi.
   2) Admin memeriksa kondisi & jumlah, lalu menyetujui (satu-satunya persetujuan; Manajemen tidak ikut).
   3) Saat Admin menyetujui, stok/kerusakan/hilang/habis-pakai langsung diproses final (status -> dikembalikan). */
/* =========================================================
   MODUL KENDALA PENGEMBALIAN (satu barang boleh punya banyak kendala sekaligus)
   ---------------------------------------------------------
   Konsep data yang disimpan pada setiap peminjaman:
       loan.pendingIssues = [
           { id, type: 'hilang'|'habis'|'rusak'|'maintenance', qty, note, photo },
           ...
       ]
   Setiap kendala adalah RECORD TERSENDIRI (tidak digabung jadi satu angka), sehingga
   satu barang bisa punya "Habis: 3" dan "Rusak: 2" sekaligus. Sisa unit yang tidak
   tercakup kendala apa pun dianggap kembali dalam kondisi baik dan masuk lagi ke stok.
   ========================================================= */
const KENDALA_TYPES = [
    { value: 'hilang',      label: 'Hilang',      badge: 'badge-danger',  photoRequired: false },
    { value: 'habis',       label: 'Habis',       badge: 'badge-info',    photoRequired: true  },
    { value: 'rusak',       label: 'Rusak Permanen', hint: 'tidak bisa diperbaiki / dipakai lagi', badge: 'badge-danger',  photoRequired: false },
    { value: 'maintenance', label: 'Maintenance',    hint: 'masih bisa diperbaiki / dipakai lagi', badge: 'badge-warning', photoRequired: false }
];
function kendalaMeta(type) { return KENDALA_TYPES.find(t => t.value === type) || null; }
function kendalaLabel(type) { const m = kendalaMeta(type); return m ? m.label : (type || '-'); }
function kendalaBadgeClass(type) { const m = kendalaMeta(type); return m ? m.badge : 'badge-muted'; }
function kendalaNeedsPhoto(type) { const m = kendalaMeta(type); return !!(m && m.photoRequired); }

// Draft kendala yang sedang disusun di form, dikelompokkan per "key".
// key = 'single' untuk pengembalian biasa, atau loan.id untuk tiap baris pengembalian event.
let returnIssueDraft = {};
// Menandai barang mana yang boleh memakai kendala "Habis": hanya barang yang
// dicentang sebagai Barang Habis Pakai/ATK di Data Barang (item.isConsumable).
let returnIssueAllowHabis = {};
function initKendalaDraft(key, allowHabis) {
    returnIssueDraft[key] = [];
    returnIssueAllowHabis[key] = !!allowHabis;
}
// Daftar jenis kendala yang tersedia untuk satu barang tertentu.
function kendalaTypesFor(key) {
    return returnIssueAllowHabis[key] ? KENDALA_TYPES : KENDALA_TYPES.filter(t => t.value !== 'habis');
}
function getKendalaDraft(key) {
    if (!returnIssueDraft[key]) returnIssueDraft[key] = [];
    return returnIssueDraft[key];
}
function kendalaTotalQty(list) { return (list || []).reduce((sum, k) => sum + (Number(k.qty) || 0), 0); }

// Kerangka HTML blok "Kendala" untuk satu barang (tombol + daftar kendala + ringkasan).
function kendalaFieldHtml(key, maxQty) {
    return `
    <div class="kendala-box">
        <div class="kendala-head">
            <div>
                <div class="kendala-title">Kendala Barang</div>
                <div class="kendala-hint">Tekan "Kendala" bila ada unit yang bermasalah. Satu barang boleh punya lebih dari satu kendala sekaligus.${returnIssueAllowHabis[key] ? '' : '<br>Jenis kendala <strong>Habis</strong> hanya tersedia untuk Barang Habis Pakai/ATK.'}</div>
            </div>
            <button type="button" class="btn btn-sm btn-warning" onclick="addKendalaRow('${key}', ${maxQty})">
                <i data-lucide="alert-triangle"></i>Kendala
            </button>
        </div>
        <div id="kendala-rows-${key}"></div>
        <div class="kendala-summary" id="kendala-summary-${key}"></div>
    </div>`;
}
// Menambah satu baris kendala baru. Jenis yang belum terpakai dipilih otomatis supaya tidak dobel.
function addKendalaRow(key, maxQty) {
    const list = getKendalaDraft(key);
    const sisa = maxQty - kendalaTotalQty(list);
    if (sisa <= 0) {
        toast(`Seluruh ${maxQty} unit sudah tercakup kendala. Ubah jumlah pada kendala yang ada bila perlu.`, 'warning');
        return;
    }
    const tersedia = kendalaTypesFor(key);
    if (list.length >= tersedia.length) {
        toast('Semua jenis kendala sudah ditambahkan untuk barang ini.', 'warning');
        return;
    }
    const used = list.map(k => k.type);
    const next = tersedia.find(t => !used.includes(t.value)) || tersedia[0];
    list.push({ id: uid('kdl'), type: next.value, qty: Math.min(1, sisa), note: '', photo: '' });
    renderKendalaRows(key, maxQty);
}
// Menghapus satu baris kendala.
function removeKendalaRow(key, id, maxQty) {
    returnIssueDraft[key] = getKendalaDraft(key).filter(k => k.id !== id);
    renderKendalaRows(key, maxQty);
}
// Memperbarui satu field pada baris kendala. rerender=true dipakai saat jenis kendala berubah
// (karena kewajiban foto ikut berubah); selain itu cukup ringkasannya yang di-refresh supaya
// fokus ketikan pengguna tidak hilang.
function updateKendalaRow(key, id, field, value, maxQty, rerender) {
    const k = getKendalaDraft(key).find(x => x.id === id);
    if (!k) return;
    if (field === 'qty') {
        let n = Math.floor(Number(value) || 0);
        if (n < 0) n = 0;
        k.qty = n;
    } else {
        k[field] = value;
    }
    if (rerender) renderKendalaRows(key, maxQty);
    else updateKendalaSummary(key, maxQty);
}
// Menggambar ulang seluruh baris kendala pada satu barang.
function renderKendalaRows(key, maxQty) {
    const wrap = document.getElementById(`kendala-rows-${key}`);
    if (!wrap) return;
    const list = getKendalaDraft(key);
    wrap.innerHTML = list.map((k, idx) => {
        const wajibFoto = kendalaNeedsPhoto(k.type);
        return `
        <div class="kendala-row">
            <div class="kendala-row-head">
                <span class="badge ${kendalaBadgeClass(k.type)}">Kendala ${idx + 1}: ${kendalaLabel(k.type)}</span>
                <button type="button" class="btn-icon text-danger" title="Hapus kendala ini" onclick="removeKendalaRow('${key}','${k.id}',${maxQty})">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Jenis Kendala</label>
                    <select onchange="updateKendalaRow('${key}','${k.id}','type',this.value,${maxQty},true)">
                        ${kendalaTypesFor(key).map(t => `<option value="${t.value}" ${t.value === k.type ? 'selected' : ''}>${t.label}${t.hint ? ' (' + t.hint + ')' : ''}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Jumlah Unit Bermasalah</label>
                    <input type="number" min="1" max="${maxQty}" value="${k.qty}"
                           oninput="updateKendalaRow('${key}','${k.id}','qty',this.value,${maxQty},false)">
                </div>
            </div>
            <div class="form-group">
                <label>Keterangan / Kronologi (opsional)</label>
                <textarea rows="2" placeholder="cth: jatuh saat pemasangan, layar pecah"
                          oninput="updateKendalaRow('${key}','${k.id}','note',this.value,${maxQty},false)">${escapeHtml(k.note || '')}</textarea>
            </div>
            <div class="form-group">
                <label>Foto Bukti ${wajibFoto ? '<span class="text-danger">(wajib untuk kendala Habis)</span>' : '(opsional)'}</label>
                <div style="display:flex;gap:8px;">
                    <div class="upload-box" style="flex:1;" onclick="document.getElementById('kendala-file-${key}-${k.id}').click()">
                        <i data-lucide="upload"></i><div>Unggah dari galeri</div>
                    </div>
                    <div class="upload-box" style="flex:1;" onclick="captureKendalaPhoto('${key}','${k.id}',${maxQty})">
                        <i data-lucide="camera"></i><div>Ambil foto langsung</div>
                    </div>
                </div>
                <input type="file" class="hidden" accept="image/*" id="kendala-file-${key}-${k.id}"
                       onchange="uploadKendalaPhoto(event,'${key}','${k.id}',${maxQty})">
                ${k.photo ? `<img src="${k.photo}" class="upload-preview">` : ''}
            </div>
        </div>`;
    }).join('');
    updateKendalaSummary(key, maxQty);
    if (window.lucide) lucide.createIcons();
}
// Ringkasan hidup: total unit bermasalah vs total unit yang dikembalikan, plus sisa unit tanpa kendala.
function updateKendalaSummary(key, maxQty) {
    const el = document.getElementById(`kendala-summary-${key}`);
    if (!el) return;
    const list = getKendalaDraft(key);
    if (!list.length) {
        el.innerHTML = `<span class="badge badge-success">Tanpa kendala</span>
            <span class="kendala-hint">Seluruh ${maxQty} unit dianggap kembali dalam kondisi baik.</span>`;
        return;
    }
    const total = kendalaTotalQty(list);
    const sisa = maxQty - total;
    const lebih = total > maxQty;
    el.innerHTML = `
        <div class="kendala-summary-list">
            ${list.map(k => `<span class="badge ${kendalaBadgeClass(k.type)}">${kendalaLabel(k.type)}: ${Number(k.qty) || 0} unit</span>`).join('')}
        </div>
        <div class="${lebih ? 'text-danger' : 'kendala-hint'}" style="margin-top:6px;">
            Total bermasalah: <strong>${total}</strong> dari ${maxQty} unit &middot;
            ${lebih
                ? `Melebihi jumlah barang yang dikembalikan (maks ${maxQty}).`
                : `Sisa <strong>${sisa}</strong> unit tanpa kendala &rarr; kembali ke stok.`}
        </div>`;
}
// Mengambil foto bukti kendala lewat kamera realtime (berwatermark tanggal/waktu/lokasi).
function captureKendalaPhoto(key, id, maxQty) {
    openCameraCapture((dataUrl) => {
        const k = getKendalaDraft(key).find(x => x.id === id);
        if (!k) return;
        k.photo = dataUrl;
        renderKendalaRows(key, maxQty);
    }, 'Ambil Foto Bukti Kendala');
}
// Mengunggah foto bukti kendala dari galeri/berkas.
function uploadKendalaPhoto(e, key, id, maxQty) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
        const k = getKendalaDraft(key).find(x => x.id === id);
        if (!k) return;
        k.photo = ev.target.result;
        renderKendalaRows(key, maxQty);
    };
    reader.readAsDataURL(file);
}
// Validasi terpusat sebelum data disimpan (dipakai form biasa maupun form event).
// Mengembalikan { ok, msg } atau { ok:true, issues, total, qtyGood }.
function validateKendalaDraft(key, maxQty, itemName) {
    const raw = getKendalaDraft(key);
    const label = itemName ? `"${itemName}"` : 'barang ini';
    const issues = raw.map(k => ({
        id: k.id, type: k.type, qty: Math.floor(Number(k.qty) || 0),
        note: (k.note || '').trim(), photo: k.photo || ''
    }));
    for (const k of issues) {
        if (!kendalaMeta(k.type)) return { ok: false, msg: `Jenis kendala tidak dikenal pada ${label}.` };
        if (k.type === 'habis' && !returnIssueAllowHabis[key]) {
            return { ok: false, msg: `Kendala "Habis" hanya berlaku untuk Barang Habis Pakai/ATK, sedangkan ${label} bukan barang habis pakai.` };
        }
        if (k.qty <= 0) return { ok: false, msg: `Jumlah unit untuk kendala ${kendalaLabel(k.type)} pada ${label} minimal 1.` };
        if (kendalaNeedsPhoto(k.type) && !k.photo) return { ok: false, msg: `Foto bukti wajib untuk kendala ${kendalaLabel(k.type)} pada ${label}.` };
    }
    const types = issues.map(k => k.type);
    const dobel = types.find((t, i) => types.indexOf(t) !== i);
    if (dobel) return { ok: false, msg: `Kendala ${kendalaLabel(dobel)} pada ${label} ditambahkan lebih dari sekali. Gabungkan jumlahnya dalam satu baris.` };
    const total = kendalaTotalQty(issues);
    if (total > maxQty) return { ok: false, msg: `Total unit bermasalah (${total}) pada ${label} melebihi jumlah yang dikembalikan (${maxQty}).` };
    return { ok: true, issues, total, qtyGood: maxQty - total };
}
// Menyimpulkan satu label kondisi ringkas dari daftar kendala (dipakai agar tampilan & data lama tetap kompatibel).
// Finalisasi pengembalian oleh Admin (satu-satunya tahap persetujuan): unit baik kembali ke stok, sedangkan
// kendala (rusak / hilang / maintenance / habis pakai) dicatat ke modul terkait. Berlaku untuk semua kondisi.
function finalizeAdminReturn(db, loan) {
    const issues = Array.isArray(loan.pendingIssues) ? loan.pendingIssues : [];
    // Data lama tanpa rincian kendala memakai pendingCondition ('baik' = tanpa kendala).
    const bermasalah = issues.length > 0 || (!!loan.pendingCondition && loan.pendingCondition !== 'baik');
    if (bermasalah) {
        finalizeProblemReturn(db, loan, loan.pendingCondition);
    } else {
        const item = db.items.find(i => i.id === loan.itemId);
        if (item) item.stock += loan.qty;
    }
    loan.status = 'dikembalikan';
    loan.returnDate = todayStr();
    loan.condition = issues.length ? conditionFromIssues(issues) : (loan.pendingCondition || 'baik');
    loan.issues = issues.map(k => Object.assign({}, k));
    loan.returnNotes = loan.pendingReturnNotes || '';
    loan.processedBy = loan.returnSubmittedBy;
    loan.returnApprovedBy = currentUser().name;
    loan.adminReturnApprovedBy = currentUser().name;
    loan.adminReturnApprovedDate = todayStr();
    clearPendingReturnFields(loan);
}
function conditionFromIssues(issues) {
    if (!issues || !issues.length) return 'baik';
    if (issues.length === 1) {
        const map = { hilang: 'hilang', habis: 'habis_pakai', rusak: 'rusak', maintenance: 'mt' };
        return map[issues[0].type] || 'campuran';
    }
    return 'campuran';
}
// Menyusun kalimat kronologi gabungan dari seluruh kendala (untuk kolom keterangan/riwayat).
function kendalaChronologyText(issues) {
    return (issues || [])
        .map(k => `${kendalaLabel(k.type)} (${k.qty} unit)${k.note ? ': ' + k.note : ''}`)
        .join(' | ');
}
// Rangkaian badge ringkas untuk ditampilkan di tabel persetujuan/riwayat.
function kendalaSummaryHtml(issues, totalQty) {
    if (!issues || !issues.length) return '<span class="badge badge-success">Tanpa kendala</span>';
    const total = kendalaTotalQty(issues);
    const sisa = (Number(totalQty) || 0) - total;
    const badges = issues.map(k => `<span class="badge ${kendalaBadgeClass(k.type)}">${kendalaLabel(k.type)}: ${k.qty}</span>`).join(' ');
    return badges + (sisa > 0 ? ` <span class="badge badge-success">Baik: ${sisa}</span>` : '');
}
// Sel kondisi untuk pengajuan yang sedang menunggu persetujuan (fallback ke data lama tanpa kendala).
function pendingConditionCell(loan) {
    return Array.isArray(loan.pendingIssues) ? kendalaSummaryHtml(loan.pendingIssues, loan.qty) : conditionBadge(loan.pendingCondition);
}
// Sel kondisi untuk riwayat pengembalian yang sudah final.
function historyConditionCell(loan) {
    if (Array.isArray(loan.issues)) return kendalaSummaryHtml(loan.issues, loan.qty);
    return conditionBadge(loan.condition);
}
// Menampilkan rincian lengkap tiap kendala (jumlah, keterangan, foto bukti) dalam modal.
function viewKendalaDetail(loanId) {
    const db = getDB();
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    const issues = Array.isArray(loan.pendingIssues) ? loan.pendingIssues
                 : (Array.isArray(loan.issues) ? loan.issues : null);
    if (!issues) {
        openModal(`Detail Pengembalian - ${loan.itemName}`, `
            <p>Kondisi: ${conditionBadge(loan.pendingCondition || loan.condition)}</p>
            <p class="text-muted">${escapeHtml(loan.pendingChronology || loan.returnNotes || 'Tidak ada keterangan tambahan.')}</p>`);
        return;
    }
    const total = kendalaTotalQty(issues);
    const sisa = loan.qty - total;
    openModal(`Detail Kendala - ${loan.itemName}`, `
        <p class="text-muted" style="margin-bottom:12px;">
            Total dikembalikan: <strong>${loan.qty} unit</strong> &middot;
            Bermasalah: <strong>${total} unit</strong> &middot;
            Tanpa kendala: <strong>${sisa < 0 ? 0 : sisa} unit</strong>
        </p>
        ${issues.length ? issues.map(k => `
            <div class="kendala-row">
                <div class="kendala-row-head">
                    <span class="badge ${kendalaBadgeClass(k.type)}">${kendalaLabel(k.type)}: ${k.qty} unit</span>
                </div>
                <p style="margin:0 0 6px;">${escapeHtml(k.note || 'Tanpa keterangan.')}</p>
                ${k.photo ? `<img src="${k.photo}" class="kendala-detail-photo">` : '<p class="text-muted" style="margin:0;">Tidak ada foto bukti.</p>'}
            </div>`).join('') : '<p class="text-muted">Tidak ada kendala yang dilaporkan.</p>'}
        ${loan.pendingLastLocation ? `<p class="text-muted">Lokasi terakhir terlihat: ${escapeHtml(loan.pendingLastLocation)}</p>` : ''}
    `);
}
function openReturnForm(loanId) {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    const item = db.items.find(i => i.id === loan.itemId);
    const key = 'single';
    initKendalaDraft(key, !!(item && item.isConsumable));
    openModal('Ajukan Pengembalian Barang', `
        <form id="return-form" onsubmit="submitReturnForm(event, '${loanId}')">
            <div class="kendala-item-head">
                ${escapeHtml(loan.itemName)}
                <span class="text-muted">&middot; dikembalikan: ${loan.qty} unit</span>
            </div>
            ${kendalaFieldHtml(key, loan.qty)}
            <div class="form-group"><label>Lokasi Terakhir Terlihat (opsional)</label>
                <input type="text" id="return-lastloc" placeholder="cth: Ruang Meeting Lt.2">
            </div>
            <div class="form-group"><label>Catatan Pengembalian (opsional)</label><textarea id="return-notes"></textarea></div>
            <p class="text-muted" style="margin-bottom:12px;">Pengajuan ini diperiksa dan disetujui Admin. Setelah disetujui, stok dan catatan kendala diperbarui otomatis.</p>
            <button type="submit" class="btn btn-primary">Ajukan Pengembalian</button>
        </form>
    `);
    renderKendalaRows(key, loan.qty);
}
// Mengajukan pengembalian satu barang beserta seluruh kendalanya (bisa lebih dari satu jenis).
function submitReturnForm(e, loanId) {
    e.preventDefault();
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan) return;
    const res = validateKendalaDraft('single', loan.qty, loan.itemName);
    if (!res.ok) { toast(res.msg, 'danger'); return; }
    loan.status = 'menunggu_admin_pengembalian';
    loan.pendingIssues = res.issues;                       // record kendala tersimpan terpisah per jenis
    loan.pendingCondition = conditionFromIssues(res.issues);
    loan.pendingChronology = kendalaChronologyText(res.issues);
    loan.pendingLastLocation = document.getElementById('return-lastloc').value.trim();
    loan.pendingReturnNotes = document.getElementById('return-notes').value.trim();
    loan.returnSubmittedBy = currentUser().name;
    loan.returnSubmittedDate = todayStr();
    delete loan.pendingQtyRecovered; delete loan.pendingPhoto;
    if (!saveDB(db)) return;
    closeModal();
    toast(res.issues.length
        ? `Pengembalian diajukan dengan ${res.issues.length} kendala (${res.total} dari ${loan.qty} unit bermasalah), menunggu Admin.`
        : 'Pengembalian diajukan, menunggu persetujuan Admin.', 'warning');
    returnTab = 'persetujuan';
    navigateTo('returns');
}
// Menghapus semua field "pending" milik satu pengajuan pengembalian (dipakai setelah final/ditolak).
function clearPendingReturnFields(loan) {
    delete loan.pendingCondition; delete loan.pendingChronology; delete loan.pendingLastLocation;
    delete loan.pendingQtyRecovered; delete loan.pendingPhoto; delete loan.pendingReturnNotes;
    delete loan.pendingIssues;
}
// Memproses final kondisi bermasalah (rusak/mt/hilang/habis pakai) ke modul terkait. Dipanggil oleh
// finalizeAdminReturn() saat Admin menyetujui pengembalian.
function finalizeProblemReturn(db, loan, condition) {
    // Alur baru: kendala tersimpan terstruktur di loan.pendingIssues.
    if (Array.isArray(loan.pendingIssues)) { finalizeIssuesReturn(db, loan); return; }
    // Alur lama (data yang dibuat sebelum fitur Kendala) tetap didukung.
    if (condition === 'hilang') {
        const qtyFound = Math.min(loan.pendingQtyRecovered || 0, loan.qty);
        const qtyLost = loan.qty - qtyFound;
        if (qtyFound > 0) { const item = db.items.find(i => i.id === loan.itemId); if (item) item.stock += qtyFound; }
        if (qtyLost > 0) {
            db.lost.push({
                id: uid('lost'), itemId: loan.itemId, itemName: loan.itemName, qty: qtyLost,
                lastLocation: loan.pendingLastLocation || '', description: loan.pendingChronology || '',
                source: 'pengembalian', loanId: loan.id,
                reportedBy: loan.returnSubmittedBy, date: todayStr(), status: 'writeoff'
            });
        }
    } else if (condition === 'rusak') {
        const qtyFixed = Math.min(loan.pendingQtyRecovered || 0, loan.qty);
        const qtyPermanent = loan.qty - qtyFixed;
        if (qtyFixed > 0) { const item = db.items.find(i => i.id === loan.itemId); if (item) item.stock += qtyFixed; }
        if (qtyPermanent > 0) {
            db.damages.push({
                id: uid('dmg'), itemId: loan.itemId, itemName: loan.itemName, qty: qtyPermanent,
                type: 'rusak', description: loan.pendingChronology || '', lastLocation: loan.pendingLastLocation || '',
                source: 'pengembalian', loanId: loan.id,
                reportedBy: loan.returnSubmittedBy, date: todayStr(), status: 'permanen'
            });
        }
    } else if (condition === 'mt') {
        const qtyMt = Math.min(loan.pendingQtyRecovered ?? loan.qty, loan.qty);
        const qtyGood = loan.qty - qtyMt;
        if (qtyGood > 0) { const item = db.items.find(i => i.id === loan.itemId); if (item) item.stock += qtyGood; }
        if (qtyMt > 0) {
            db.damages.push({
                id: uid('dmg'), itemId: loan.itemId, itemName: loan.itemName, qty: qtyMt,
                type: 'mt', description: loan.pendingChronology || '', lastLocation: loan.pendingLastLocation || '',
                source: 'pengembalian', loanId: loan.id,
                reportedBy: loan.returnSubmittedBy, date: todayStr(), status: 'menunggu'
            });
        }
    } else if (condition === 'habis_pakai') {
        db.consumables.push({
            id: uid('cons'), itemId: loan.itemId, itemName: loan.itemName, qty: loan.qty,
            level: 'habis_pakai', photo: loan.pendingPhoto || '', note: loan.pendingChronology || '',
            source: 'pengembalian', loanId: loan.id,
            reportedBy: loan.returnSubmittedBy, date: todayStr(), status: 'disetujui'
        });
    }
}
// Memproses seluruh kendala satu barang ke modul terkait. Tiap kendala jadi record sendiri:
//   hilang      -> Barang Hilang (writeoff)
//   rusak       -> Barang Rusak/MT (permanen)
//   maintenance -> Barang Rusak/MT (menunggu perbaikan)
//   habis       -> Barang Habis Pakai/ATK (beserta foto buktinya)
// Sisa unit yang tidak punya kendala dikembalikan ke stok.
function finalizeIssuesReturn(db, loan) {
    const issues = loan.pendingIssues || [];
    const totalProblem = kendalaTotalQty(issues);
    const qtyGood = Math.max(0, loan.qty - totalProblem);
    if (qtyGood > 0) {
        const item = db.items.find(i => i.id === loan.itemId);
        if (item) item.stock += qtyGood;
    }
    issues.forEach(k => {
        const qty = Number(k.qty) || 0;
        if (qty <= 0) return;
        const base = {
            itemId: loan.itemId, itemName: loan.itemName, qty,
            source: 'pengembalian', loanId: loan.id,
            reportedBy: loan.returnSubmittedBy, date: todayStr()
        };
        const desc = k.note || '';
        if (k.type === 'hilang') {
            db.lost.push(Object.assign({}, base, {
                id: uid('lost'), lastLocation: loan.pendingLastLocation || '',
                description: desc, photo: k.photo || '', status: 'writeoff'
            }));
        } else if (k.type === 'rusak') {
            db.damages.push(Object.assign({}, base, {
                id: uid('dmg'), type: 'rusak', description: desc,
                lastLocation: loan.pendingLastLocation || '', photo: k.photo || '', status: 'permanen'
            }));
        } else if (k.type === 'maintenance') {
            db.damages.push(Object.assign({}, base, {
                id: uid('dmg'), type: 'mt', description: desc,
                lastLocation: loan.pendingLastLocation || '', photo: k.photo || '', status: 'menunggu'
            }));
        } else if (k.type === 'habis') {
            db.consumables.push(Object.assign({}, base, {
                id: uid('cons'), level: 'habis_pakai', photo: k.photo || '',
                note: desc, status: 'disetujui'
            }));
        }
    });
}
// Admin menyetujui pengajuan pengembalian (satu-satunya persetujuan): stok & catatan kendala langsung diproses.
function approveReturnAdmin(loanId) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan || loan.status !== 'menunggu_admin_pengembalian') return;
    finalizeAdminReturn(db, loan);
    saveDB(db);
    toast('Pengembalian disetujui Admin. Stok dan catatan terkait sudah diperbarui.');
    renderPage('returns');
    renderSidebar();
}
// Admin menolak pengajuan pengembalian -> barang kembali berstatus Sedang Dipinjam.
function rejectReturnAdmin(loanId) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const loan = db.loans.find(l => l.id === loanId);
    if (!loan || loan.status !== 'menunggu_admin_pengembalian') return;
    if (!confirm('Tolak pengajuan pengembalian ini? Barang akan kembali berstatus Sedang Dipinjam.')) return;
    loan.status = 'dipinjam';
    clearPendingReturnFields(loan);
    delete loan.returnSubmittedBy; delete loan.returnSubmittedDate;
    saveDB(db);
    toast('Pengajuan pengembalian ditolak Admin, kembali ke status Sedang Dipinjam.', 'warning');
    renderPage('returns');
    renderSidebar();
}
/* ---------- Aksi & pengembalian khusus paket Peminjaman Event ---------- */
// Setujui semua barang dalam satu paket event sekaligus (cukup Admin, 1 tahap,
// sama seperti peminjaman biasa). Stok dicek dulu untuk semua barang sebelum
// ada satu pun yang dipotong, supaya tidak terjadi pemotongan stok sebagian.
function approveEventLoan(eventId) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const items = db.loans.filter(l => l.eventId === eventId && l.status === 'menunggu_admin');
    if (!items.length) return;
    for (const loan of items) {
        const item = db.items.find(i => i.id === loan.itemId);
        if (!item || item.stock < loan.qty) {
            toast(`Stok "${loan.itemName}" tidak lagi mencukupi. Peminjaman event tidak dapat disetujui.`, 'danger');
            return;
        }
    }
    items.forEach(loan => {
        const item = db.items.find(i => i.id === loan.itemId);
        item.stock -= loan.qty;
        loan.status = 'dipinjam';
        loan.adminApprovedBy = currentUser().name;
        loan.adminApprovedDate = todayStr();
    });
    saveDB(db);
    toast(`Peminjaman event "${items[0].eventName}" disetujui Admin (${items.length} jenis barang). Stok diperbarui.`);
    renderPage('loans');
    renderSidebar();
}
// Admin menolak seluruh pengajuan peminjaman dalam satu paket event, dengan alasan opsional.
function rejectEventLoan(eventId) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const items = db.loans.filter(l => l.eventId === eventId && l.status === 'menunggu_admin');
    if (!items.length) return;
    const reason = prompt('Alasan penolakan (opsional):', '') || '';
    items.forEach(loan => {
        loan.status = 'ditolak';
        loan.rejectedBy = currentUser().name;
        loan.rejectedDate = todayStr();
        loan.rejectReason = reason.trim();
    });
    saveDB(db);
    toast('Pengajuan peminjaman event ditolak (seluruh barang).', 'warning');
    renderPage('loans');
    renderSidebar();
}
// Form pengembalian event: setiap barang bisa punya kondisi berbeda-beda
// (baik/rusak/mt/hilang/habis pakai), tapi diajukan sebagai satu paket.
// Alur sama seperti pengembalian biasa: diperiksa dan disetujui Admin saja.
function openEventReturnForm(eventId) {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const items = db.loans.filter(l => l.eventId === eventId && l.status === 'dipinjam');
    if (!items.length) return;
    const first = items[0];
    // Tiap barang punya daftar kendalanya sendiri; opsi "Habis" hanya untuk barang ATK/habis pakai.
    items.forEach(l => {
        const it = db.items.find(i => i.id === l.itemId);
        initKendalaDraft(l.id, !!(it && it.isConsumable));
    });
    const rowsHtml = items.map(l => `
        <div class="kendala-item-block">
            <div class="kendala-item-head">
                ${escapeHtml(l.itemName)}
                <span class="text-muted">&middot; dikembalikan: ${l.qty} unit</span>
            </div>
            ${kendalaFieldHtml(l.id, l.qty)}
            <div class="form-group"><label>Lokasi Terakhir Terlihat (opsional)</label>
                <input type="text" id="evret-loc-${l.id}">
            </div>
        </div>`).join('');
    openModal(`Proses Pengembalian Event: ${first.eventName}`, `
        <form id="event-return-form" onsubmit="submitEventReturnForm(event, '${eventId}')">
            <p class="text-muted" style="margin-bottom:8px;">Tambahkan kendala untuk masing-masing barang bila ada. Barang tanpa kendala dianggap kembali dalam kondisi baik.</p>
            ${rowsHtml}
            <div class="form-group" style="margin-top:12px;"><label>Catatan Pengembalian Umum (opsional)</label><textarea id="evret-notes"></textarea></div>
            <p class="text-muted" style="margin-bottom:12px;">Pengajuan ini diperiksa dan disetujui Admin. Setelah disetujui, stok dan catatan kendala diperbarui otomatis.</p>
            <button type="submit" class="btn btn-primary">Ajukan Pengembalian Event</button>
        </form>
    `);
    items.forEach(l => renderKendalaRows(l.id, l.qty));
}
// Mengajukan pengembalian satu paket event sebagai PENGAJUAN (belum final), dengan kondisi
// yang bisa berbeda-beda untuk tiap barang di dalam paket tersebut.
// Mengajukan pengembalian satu paket event sebagai PENGAJUAN (belum final). Setiap barang
// dalam paket bisa punya kombinasi kendala yang berbeda-beda.
function submitEventReturnForm(e, eventId) {
    e.preventDefault();
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const items = db.loans.filter(l => l.eventId === eventId && l.status === 'dipinjam');
    if (!items.length) return;
    const notes = document.getElementById('evret-notes').value.trim();
    // Validasi seluruh barang dulu, supaya tidak ada yang tersimpan sebagian saat ada yang gagal.
    const hasil = {};
    for (const loan of items) {
        const res = validateKendalaDraft(loan.id, loan.qty, loan.itemName);
        if (!res.ok) { toast(res.msg, 'danger'); return; }
        hasil[loan.id] = res;
    }
    let totalKendala = 0;
    items.forEach(loan => {
        const res = hasil[loan.id];
        const loc = document.getElementById(`evret-loc-${loan.id}`);
        totalKendala += res.issues.length;
        loan.status = 'menunggu_admin_pengembalian';
        loan.pendingIssues = res.issues;
        loan.pendingCondition = conditionFromIssues(res.issues);
        loan.pendingChronology = kendalaChronologyText(res.issues);
        loan.pendingLastLocation = loc ? loc.value.trim() : '';
        loan.pendingReturnNotes = notes;
        loan.returnSubmittedBy = currentUser().name;
        loan.returnSubmittedDate = todayStr();
        delete loan.pendingQtyRecovered; delete loan.pendingPhoto;
    });
    if (!saveDB(db)) return;
    closeModal();
    toast(totalKendala
        ? `Pengembalian event diajukan dengan ${totalKendala} kendala, menunggu persetujuan Admin.`
        : 'Pengembalian event diajukan, menunggu persetujuan Admin.', 'warning');
    returnTab = 'persetujuan';
    navigateTo('returns');
}
// Admin menyetujui pengembalian event: seluruh barang dalam paket diproses final (stok & kendala).
function approveEventReturnAdmin(eventId) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const items = db.loans.filter(l => l.eventId === eventId && l.status === 'menunggu_admin_pengembalian');
    if (!items.length) return;
    items.forEach(loan => finalizeAdminReturn(db, loan));
    saveDB(db);
    toast(`Pengembalian event "${items[0].eventName}" disetujui Admin & seluruh barang diproses.`);
    renderPage('returns');
    renderSidebar();
}
// Admin menolak pengembalian event -> semua barang kembali berstatus Sedang Dipinjam.
function rejectEventReturnAdmin(eventId) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const items = db.loans.filter(l => l.eventId === eventId && l.status === 'menunggu_admin_pengembalian');
    if (!items.length) return;
    if (!confirm('Tolak pengajuan pengembalian event ini? Semua barang akan kembali berstatus Sedang Dipinjam.')) return;
    items.forEach(loan => {
        loan.status = 'dipinjam';
        clearPendingReturnFields(loan);
        delete loan.returnSubmittedBy; delete loan.returnSubmittedDate;
    });
    saveDB(db);
    toast('Pengajuan pengembalian event ditolak Admin, kembali ke status Sedang Dipinjam.', 'warning');
    renderPage('returns');
    renderSidebar();
}

/* =========================================================
   PEMBELIAN BARANG BARU (stok masuk + invoice foto)
   ========================================================= */
const dateOf = o => o.purchaseDate || o.date || '';
const sameInfo = (it, x) => dateOf(it) === dateOf(x) && it.condition === x.condition && Number(it.price) === Number(x.price) && (it.conditionNote || '') === (x.conditionNote || '');
const sameName = (a, b) => (a.name || '').toLowerCase() === (b.name || '').toLowerCase() && (a.brand || '').toLowerCase() === (b.brand || '').toLowerCase();
// Mencari barang dengan nama+merk sama dan info (kondisi, harga, keterangan minus) sama persis.
function findItemVariant(items, base, info) {
    return items.find(it => sameName(it, base) && sameInfo(it, info));
}
// Memindahkan jumlah unit sebuah pembelian ke barang varian (dibuat bila belum ada) sesuai info pembelian itu.
function movePurchaseToVariant(db, p, it) {
    let target = db.items.find(x => x.id !== it.id && sameName(x, it) && sameInfo(x, p));
    if (!target) {
        target = Object.assign({}, it, { id: uid('itm'), electronicCode: '', stock: 0, purchaseDate: p.date, price: p.price,
            condition: p.condition, conditionNote: p.conditionNote || '' });
        db.items.push(target);
    }
    const moved = Math.min(it.stock, p.qty);
    it.stock -= moved; target.stock += moved;
    p.itemId = target.id;
}
// Setelah info sebuah pembelian diedit: bila itu satu-satunya sumber barangnya, info barang ikut berubah;
// bila barang punya pembelian lain, unit pembelian ini dipindah ke barang varian agar kondisi tidak tercampur.
function syncPurchaseVariant(db, p) {
    const it = db.items.find(x => x.id === p.itemId);
    if (!it || sameInfo(it, p)) return;
    if (!db.purchases.some(x => x.itemId === it.id && x.id !== p.id)) {
        Object.assign(it, { purchaseDate: p.date, price: p.price, condition: p.condition, conditionNote: p.conditionNote || '' });
    } else movePurchaseToVariant(db, p, it);
}
// Foto invoice sebuah record; record turunan (satu transaksi, banyak barang) merujuk ke record pertama.
function purchaseInvoice(db, p) {
    if (p.invoicePhoto) return p.invoicePhoto;
    const src = p.invoiceRef && db.purchases.find(x => x.id === p.invoiceRef);
    return src ? src.invoicePhoto : null;
}
function renderPurchasesPage() {
    if (!hasRole('admin', 'manajemen')) return `<p class="text-muted">Anda tidak memiliki akses ke halaman ini.</p>`;
    const db = getDB();
    const F = filterState('purchases');
    const rows = db.purchases
        .filter(p => dateMatches(F, p.date) && (!F.st || p.condition === F.st) && queryMatches(F.q, [p.code, p.itemName, p.itemBrand, p.itemId, p.supplier]))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    return `
    <div class="page-header">
        <p>Catat pembelian barang baru untuk menambah stok. Tanggal, kondisi, harga, dan keterangan minus dicatat per barang.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${hasRole('manajemen') ? '<button class="btn btn-danger" onclick="openPurchaseHistoryPurge()"><i data-lucide="trash-2"></i>Hapus Riwayat</button>' : ''}
            <button class="btn btn-primary" onclick="openPurchaseForm()"><i data-lucide="plus"></i>Catat Pembelian</button>
        </div>
    </div>
    ${filterBar('purchases', { placeholder: 'Cari ID Form / barang / supplier', years: yearOptions(db.purchases.map(p => p.date)),
        extra: filterSelect('purchases', 'st', ITEM_CONDITIONS, 'Semua kondisi') })}
    ${rcList(rows.map(p => {
        const inv = purchaseInvoice(db, p);
        return rcCard({
            key: 'pb:' + p.id,
            chip: fmtDMY(p.date),
            badges: `${itemCondBadge(p.condition)} <span class="badge badge-muted">${escapeHtml(p.code || '-')}</span>`,
            title: itemFullName(p.itemName, p.itemBrand),
            left: p.supplier || '-',
            right: fmtRupiah(p.price * p.qty),
            count: p.qty + ' unit',
            icon: 'package',
            detail: rcFacts([['ID Form', p.code || '-'], ['Merk', p.itemBrand || '-'], ['Tanggal Pembelian', fmtDMY(p.date)], ['Kondisi', { html: itemCondBadge(p.condition) }],
                ['Keterangan Minus', itemMinusText(p.condition, p.conditionNote)], ['Jumlah', p.qty], ['Harga satuan', fmtRupiah(p.price)],
                ['Total', fmtRupiah(p.price * p.qty)], ['Supplier', p.supplier || '-'],
                ['Invoice', inv ? { html: `<img src="${inv}" class="thumb" onclick="viewInvoice('${p.id}')" title="Lihat invoice">` } : '-']]),
            actions: `<button class="btn btn-sm btn-secondary" onclick="openPurchaseEdit('${p.id}')"><i data-lucide="pencil"></i>Edit Info</button>`
                + (inv ? ` <button class="btn btn-sm btn-secondary" onclick="viewInvoice('${p.id}')"><i data-lucide="image"></i>Lihat Invoice</button>` : '')
        });
    }), 'Tidak ada data pembelian.')}`;
}
let purchaseRowSeq = 0;
function purchaseItemOptions() {
    return getDB().items.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(itemLabel(i))}</option>`).join('');
}
// Satu baris barang di form pembelian: tiap baris punya tanggal, kondisi, harga, dan keterangan sendiri.
function purchaseRowHtml(r) {
    const pre = `pr${r}-`;
    return `<div class="pr-row" id="pr-row-${r}">
        <div class="pr-row-head"><strong>Barang <span class="pr-no"></span></strong>
            <button type="button" class="btn btn-sm btn-danger" onclick="removePurchaseRow(${r})" title="Hapus baris"><i data-lucide="trash-2"></i></button></div>
        <div class="form-group"><label>Barang</label>
            <select id="${pre}item" onchange="togglePurchaseNew(${r})" required>
                <option value="__new__">+ Barang baru (belum ada di data)</option>${purchaseItemOptions()}
            </select></div>
        <div id="${pre}new">
            <div class="form-row">
                <div class="form-group"><label>Nama Barang Baru</label><input type="text" id="${pre}newname" placeholder="cth: Laptop"></div>
                <div class="form-group"><label>Merk / Tipe</label><input type="text" id="${pre}newbrand" placeholder="cth: Asus Vivobook 14"></div>
            </div>
            <div class="form-group"><label>Kategori</label><input type="text" id="${pre}newcategory" placeholder="cth: Alat Kerja"></div>
            <div class="form-row">
                <div class="form-group"><label>Satuan</label><input type="text" id="${pre}newunit" value="pcs"></div>
                <div class="form-group"><label>Stok Minimum</label><input type="number" id="${pre}newminstock" min="0" value="1"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Lokasi</label><input type="text" id="${pre}newlocation" placeholder="cth: Gudang Utama"></div>
                <div class="form-group"><label>Rak</label><input type="text" id="${pre}newrack" placeholder="cth: 1"></div>
            </div>
        </div>
        <div class="form-group"><label>Jumlah</label><input type="number" id="${pre}qty" min="1" value="1" required></div>
        ${itemInfoFields(pre)}
    </div>`;
}
function togglePurchaseNew(r) {
    document.getElementById(`pr${r}-new`).classList.toggle('hidden', document.getElementById(`pr${r}-item`).value !== '__new__');
}
function renumberPurchaseRows() {
    document.querySelectorAll('#pr-rows .pr-no').forEach((el, i) => { el.textContent = '#' + (i + 1); });
}
function addPurchaseRow() {
    document.getElementById('pr-rows').insertAdjacentHTML('beforeend', purchaseRowHtml(++purchaseRowSeq));
    renumberPurchaseRows();
    if (window.lucide) lucide.createIcons();
}
function removePurchaseRow(r) {
    if (document.querySelectorAll('#pr-rows .pr-row').length <= 1) { toast('Minimal satu barang.', 'warning'); return; }
    document.getElementById('pr-row-' + r).remove();
    renumberPurchaseRows();
}
// Membuka form catat pembelian: satu transaksi bisa berisi banyak barang; supplier & invoice berlaku untuk seluruh transaksi.
function openPurchaseForm() {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    pendingInvoiceData = null;
    openModal('Catat Pembelian Barang', `
        <form id="purchase-form" onsubmit="submitPurchaseForm(event)">
            <div id="pr-rows"></div>
            <button type="button" class="btn btn-secondary btn-block" style="margin-bottom:16px;" onclick="addPurchaseRow()"><i data-lucide="plus"></i>Tambah Barang</button>
            <div class="form-group"><label>Supplier</label><input type="text" id="p-supplier"></div>
            <div class="form-group"><label>Foto Invoice</label>
                <div style="display:flex;gap:8px;">
                    <div class="upload-box" style="flex:1;" onclick="document.getElementById('p-invoice-file').click()">
                        <i data-lucide="upload"></i><div>Unggah dari galeri</div>
                    </div>
                    <div class="upload-box" style="flex:1;" onclick="capturePurchaseInvoicePhoto()">
                        <i data-lucide="camera"></i><div>Ambil foto langsung</div>
                    </div>
                </div>
                <input type="file" id="p-invoice-file" accept="image/*" class="hidden" onchange="previewInvoice(event)">
                <img id="p-invoice-preview" class="upload-preview hidden">
            </div>
            <button type="submit" class="btn btn-primary btn-block">Simpan & Update Stok</button>
        </form>
    `);
    addPurchaseRow();
}
let pendingInvoiceData = null; // menampung data URL foto invoice yang baru diunggah, sebelum disimpan ke database
// Mengambil foto invoice langsung dari kamera (berwatermark tanggal/waktu/lokasi).
function capturePurchaseInvoicePhoto() {
    openCameraCapture((dataUrl) => {
        pendingInvoiceData = dataUrl;
        const img = document.getElementById('p-invoice-preview');
        if (img) { img.src = dataUrl; img.classList.remove('hidden'); }
    }, 'Ambil Foto Invoice');
}
// Membaca file foto invoice yang dipilih pengguna dan menampilkan pratinjaunya (data URL) sebelum disimpan.
function previewInvoice(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
        pendingInvoiceData = ev.target.result;
        const img = document.getElementById('p-invoice-preview');
        img.src = pendingInvoiceData;
        img.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}
// Menyimpan transaksi: semua baris divalidasi dulu (tidak ada yang tersimpan bila satu baris salah), lalu
// tiap barang disimpan sebagai record sendiri dengan tanggal/kondisi/harga/keterangan masing-masing.
function submitPurchaseForm(e) {
    e.preventDefault();
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const rows = [...document.querySelectorAll('#pr-rows .pr-row')];
    if (!rows.length) { toast('Tambahkan minimal satu barang.', 'danger'); return; }
    const entries = [];
    for (let i = 0; i < rows.length; i++) {
        const pre = 'pr' + rows[i].id.replace('pr-row-', '') + '-';
        const label = `Barang #${i + 1}: `;
        const val = id => document.getElementById(pre + id).value.trim();
        const info = readItemInfo(pre);
        if (info.error) { toast(label + info.error, 'danger'); return; }
        const qty = Number(val('qty'));
        if (!(qty >= 1)) { toast(label + 'Jumlah minimal 1.', 'danger'); return; }
        const sel = val('item');
        let base;
        if (sel === '__new__') {
            const name = val('newname');
            if (!name) { toast(label + 'Nama barang baru wajib diisi.', 'danger'); return; }
            base = { name, brand: val('newbrand'), category: val('newcategory'), unit: val('newunit') || 'pcs',
                location: val('newlocation'), rack: val('newrack'), minStock: Number(val('newminstock')) || 1 };
        } else {
            const src = db.items.find(x => x.id === sel);
            if (!src) { toast(label + 'Barang tidak ditemukan.', 'danger'); return; }
            base = { name: src.name, brand: src.brand || '', category: src.category || '', unit: src.unit || 'pcs', location: src.location || '',
                rack: src.rack || '', minStock: src.minStock, electronicType: src.electronicType || '', electronicCode: '', isConsumable: !!src.isConsumable };
        }
        entries.push({ qty, info: info.data, base });
    }
    const supplier = document.getElementById('p-supplier').value.trim();
    const trxId = uid('trx');
    let firstId = null;
    entries.forEach(en => {
        // Stok digabung hanya bila nama, merk, kondisi, harga, dan keterangan minus sama persis; selain itu jadi barang terpisah.
        let item = findItemVariant(db.items, en.base, en.info);
        const created = !item;
        if (created) {
            item = Object.assign({ id: uid('itm') }, en.base, { stock: 0, purchaseDate: en.info.date, price: en.info.price,
                condition: en.info.condition, conditionNote: en.info.conditionNote });
            db.items.push(item);
        }
        item.stock += en.qty;
        const id = uid('pur');
        db.purchases.push({
            id, trxId, itemId: item.id, itemName: item.name, itemBrand: item.brand || '', qty: en.qty, price: en.info.price, supplier,
            date: en.info.date, condition: en.info.condition, conditionNote: en.info.conditionNote,
            itemCreated: created,
            invoicePhoto: firstId ? null : (pendingInvoiceData || null),
            invoiceRef: firstId || undefined,
            addedBy: currentUser().name
        });
        if (!firstId) firstId = id;
    });
    pendingInvoiceData = null;
    saveDB(db);
    closeModal();
    toast(entries.length + ' barang dicatat & stok diperbarui.');
    renderPage('purchases');
}
// Hapus riwayat pembelian (khusus Manajemen): berdasarkan tanggal batas atau semuanya. Stok & data barang tidak berubah.
function openPurchaseHistoryPurge() {
    if (!requireRole(['manajemen'], 'Manajemen')) return;
    const n = getDB().purchases.length;
    if (!n) { toast('Belum ada riwayat pembelian.', 'warning'); return; }
    openModal('Hapus Riwayat Pembelian', `
        <form onsubmit="submitPurchaseHistoryPurge(event)">
            <p class="text-muted" style="margin-bottom:12px;">Menghapus catatan riwayat pembelian beserta jejaknya di Riwayat Aktivitas.
                Stok dan data barang <strong>tidak</strong> berubah. Disarankan ekspor Excel/PDF dulu dari menu Riwayat Aktivitas.</p>
            <div class="form-group"><label>Hapus riwayat sebelum tanggal</label>
                <input type="date" id="ph-cutoff" value="${todayStr()}"></div>
            <div class="form-group"><label><input type="checkbox" id="ph-all" onchange="document.getElementById('ph-cutoff').disabled = this.checked"> Hapus semua riwayat pembelian (${n} catatan)</label></div>
            <button type="submit" class="btn btn-danger btn-block">Hapus Riwayat</button>
        </form>`);
}
function submitPurchaseHistoryPurge(e) {
    e.preventDefault();
    if (!requireRole(['manajemen'], 'Manajemen')) return;
    const all = document.getElementById('ph-all').checked;
    const cutoff = document.getElementById('ph-cutoff').value;
    if (!all && !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) { toast('Pilih tanggal batas dahulu.', 'danger'); return; }
    const db = getDB();
    const gone = db.purchases.filter(p => all || p.date < cutoff);
    if (!gone.length) { toast('Tidak ada riwayat pembelian sebelum tanggal tersebut.', 'warning'); return; }
    if (!confirm('Hapus ' + gone.length + ' catatan riwayat pembelian' + (all ? '' : ' sebelum ' + fmtDMY(cutoff)) + '? Stok tidak berubah. Tindakan ini tidak dapat dibatalkan.')) return;
    const goneIds = new Set(gone.map(p => p.id));
    // Foto invoice yang masih dirujuk record lain (satu transaksi) dipindahkan agar tidak hilang.
    gone.forEach(g => {
        if (!g.invoicePhoto) return;
        const heirs = db.purchases.filter(p => !goneIds.has(p.id) && p.invoiceRef === g.id);
        if (!heirs.length) return;
        heirs[0].invoicePhoto = g.invoicePhoto; delete heirs[0].invoiceRef;
        heirs.slice(1).forEach(h => { h.invoiceRef = heirs[0].id; });
    });
    db.purchases = db.purchases.filter(p => !goneIds.has(p.id));
    db.activityLog = db.activityLog.filter(a => !(a.coll === 'purchases' && goneIds.has(a.recId)));
    addLog(db, {
        ref: 'SISTEM', recId: '', coll: 'purchases', date: todayStr(), who: currentUser().name, status: 'dihapus', action: 'hapus riwayat pembelian',
        title: 'Manajemen menghapus ' + gone.length + ' riwayat pembelian' + (all ? ' (semua)' : ' sebelum ' + fmtDMY(cutoff)), items: [{ name: '-', qty: 0 }]
    });
    persistDB(db);
    closeModal();
    toast(gone.length + ' riwayat pembelian dihapus.', 'warning');
    renderPage('purchases');
}
// Form edit info barang pada satu catatan pembelian (hanya Admin/Manajemen).
function openPurchaseEdit(id) {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const p = getDB().purchases.find(x => x.id === id);
    if (!p) return;
    openModal('Edit Info Barang - ' + p.itemName, `
        <form onsubmit="submitPurchaseEdit(event, '${id}')">
            ${itemInfoFields('pe-', { date: p.date, price: p.price, condition: p.condition, note: p.conditionNote })}
            <button type="submit" class="btn btn-primary btn-block">Simpan</button>
        </form>`);
}
function submitPurchaseEdit(e, id) {
    e.preventDefault();
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const info = readItemInfo('pe-');
    if (info.error) { toast(info.error, 'danger'); return; }
    const db = getDB();
    const p = db.purchases.find(x => x.id === id);
    if (!p) return;
    Object.assign(p, { date: info.data.date, price: info.data.price, condition: info.data.condition, conditionNote: info.data.conditionNote });
    syncPurchaseVariant(db, p);
    saveDB(db);
    closeModal();
    toast('Informasi barang diperbarui.');
    renderPage('purchases');
}
// Menampilkan foto invoice ukuran penuh untuk satu transaksi pembelian di dalam modal.
function viewInvoice(purchaseId) {
    const db = getDB();
    const p = db.purchases.find(x => x.id === purchaseId);
    const inv = p && purchaseInvoice(db, p);
    if (!inv) return;
    openModal('Foto Invoice - ' + p.itemName, `<img src="${inv}" style="width:100%;border-radius:8px;">`);
}

/* =========================================================
   PENGAJUAN PEMBELIAN (bisa dicetak / print untuk atasan)
   ========================================================= */
function renderRequestsPage() {
    const db = getDB();
    const isManagerLevel = hasRole('admin', 'manajemen');
    const list = isManagerLevel ? db.requests : db.requests.filter(r => r.requestedBy === currentUser().name);
    const F = filterState('requests');
    const rows = list
        .filter(r => dateMatches(F, r.date) && queryMatches(F.q, [r.code, r.customNo, r.id, r.itemName, r.itemCode, r.requestedBy]))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    return `
    <div class="page-header">
        <p>Ajukan permintaan pembelian barang. ${hasRole('admin') ? 'Sebagai Admin, Anda dapat menyetujui/menolak pengajuan.' : ''}</p>
        <button class="btn btn-primary" onclick="openRequestForm()"><i data-lucide="plus"></i>Buat Pengajuan</button>
    </div>
    ${filterBar('requests', { placeholder: 'Cari ID / no. pengajuan / barang / pemohon', years: yearOptions(list.map(r => r.date)) })}
    ${rcList(rows.map(r => rcCard({
        key: 'rq:' + r.id,
        chip: fmtDate(r.date),
        badges: requestStatusBadge(r.status),
        title: r.itemName,
        left: r.requestedBy,
        right: r.customNo || r.id,
        count: r.qty + ' unit',
        icon: 'package',
        detail: rcFacts([['No. Pengajuan', r.customNo || r.id], ['ID Form', r.code], ['Kode barang', r.itemCode], ['Jumlah', r.qty],
                         ['Estimasi harga', r.estPrice ? fmtRupiah(r.estPrice) : ''], ['Alasan', r.reason]]),
        actions: (hasRole('admin') && r.status === 'pending' ? `
                <button class="btn btn-sm btn-success" onclick="updateRequestStatus('${r.id}','disetujui')"><i data-lucide="check"></i>Setujui</button>
                <button class="btn btn-sm btn-danger" onclick="updateRequestStatus('${r.id}','ditolak')"><i data-lucide="x"></i>Tolak</button>` : '')
            + (r.attachments && r.attachments.length ? `<button class="btn btn-sm btn-secondary" onclick="viewRequestAttachments('${r.id}')"><i data-lucide="paperclip"></i>Lampiran (${r.attachments.length})</button>` : '')
            + `<button class="btn btn-sm btn-secondary" onclick="printRequest('${r.id}')"><i data-lucide="printer"></i>Print</button>`
    })), 'Tidak ada pengajuan.')}`;
}
// Memetakan status pengajuan pembelian menjadi label badge berwarna.
function requestStatusBadge(status) {
    if (status === 'disetujui') return '<span class="badge badge-success">Disetujui</span>';
    if (status === 'ditolak') return '<span class="badge badge-danger">Ditolak</span>';
    return '<span class="badge badge-pink">Menunggu</span>';
}
// Membuka form untuk membuat pengajuan pembelian baru.
function openRequestForm() {
    openModal('Buat Pengajuan Pembelian', `
        <form id="request-form" onsubmit="submitRequestForm(event)">
            <div class="form-row">
                <div class="form-group"><label>No. Pengajuan (opsional, kustom)</label><input type="text" id="r-customno" placeholder="kosongkan untuk otomatis"></div>
                <div class="form-group"><label>Kode Barang (opsional, kustom)</label><input type="text" id="r-itemcode" placeholder="cth: ES0010"></div>
            </div>
            <div class="form-group"><label>Nama Barang</label><input type="text" id="r-name" required></div>
            <div class="form-row">
                <div class="form-group"><label>Jumlah</label><input type="number" id="r-qty" min="1" value="1" required></div>
                <div class="form-group"><label>Perkiraan Harga (Rp, opsional)</label><input type="number" id="r-price" min="0" value="0"></div>
            </div>
            <div class="form-group"><label>Alasan / Keterangan</label><textarea id="r-reason" placeholder="cth: stok habis, kebutuhan proyek X" required></textarea></div>
            <div class="form-group">
                <label>Foto/Dokumen Pendukung (opsional, maks ${ATTACHMENT_MAX_COUNT} file, @${fmtFileSize(ATTACHMENT_MAX_SIZE)} per file)</label>
                <div style="display:flex;gap:8px;">
                    <div class="upload-box" style="flex:1;" onclick="document.getElementById('r-attachment-input').click()">
                        <i data-lucide="upload"></i><div>Unggah file (PNG/JPG/WebP/PDF)</div>
                    </div>
                    <div class="upload-box" style="flex:1;" onclick="openCameraCapture(addCapturedPhotoToRequest, 'Ambil Foto Barang / Penawaran')">
                        <i data-lucide="camera"></i><div>Ambil foto langsung</div>
                    </div>
                </div>
                <input type="file" id="r-attachment-input" class="hidden" multiple
                       accept="image/png,image/jpeg,image/webp,application/pdf"
                       onchange="onRequestFilesSelected(event)">
                <div id="r-attachment-preview" class="attachment-grid"></div>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Ajukan</button>
        </form>
    `);
    pendingRequestAttachments = [];
    renderRequestAttachmentPreview();
}
let pendingRequestAttachments = []; // menampung lampiran yang sedang di-compose, sebelum pengajuan disubmit
// Dipanggil saat user memilih file baru dari input multiple pada form pengajuan.
function onRequestFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // supaya bisa pilih file yang sama lagi kalau perlu
    for (const file of files) {
        if (pendingRequestAttachments.length >= ATTACHMENT_MAX_COUNT) {
            toast(`Maksimal ${ATTACHMENT_MAX_COUNT} lampiran per pengajuan.`, 'warning');
            break;
        }
        addValidatedAttachment(file, null);
    }
}
// Validasi 1 file lalu (jika lolos) membaca & menambah/mengganti entri di pendingRequestAttachments.
// replaceId: jika diisi, entri dengan id tsb akan diganti; jika null, ditambah sebagai entri baru.
function addValidatedAttachment(file, replaceId) {
    if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
        toast(`Format "${file.name}" tidak didukung. Gunakan PNG, JPG, WebP, atau PDF.`, 'danger');
        return;
    }
    if (file.size > ATTACHMENT_MAX_SIZE) {
        toast(`"${file.name}" melebihi batas ${fmtFileSize(ATTACHMENT_MAX_SIZE)}.`, 'danger');
        return;
    }
    const reader = new FileReader();
    reader.onload = function (ev) {
        const entry = { id: replaceId || uid('att'), name: file.name, type: file.type, size: file.size, dataUrl: ev.target.result };
        if (replaceId) {
            const idx = pendingRequestAttachments.findIndex(a => a.id === replaceId);
            if (idx > -1) pendingRequestAttachments[idx] = entry;
        } else {
            pendingRequestAttachments.push(entry);
        }
        renderRequestAttachmentPreview();
    };
    reader.readAsDataURL(file);
}
// Merender grid thumbnail lampiran yang sedang di-compose (belum disubmit), lengkap
// tombol Ganti & Hapus per item.
function renderRequestAttachmentPreview() {
    const wrap = document.getElementById('r-attachment-preview');
    if (!wrap) return;
    wrap.innerHTML = pendingRequestAttachments.map(a => `
        <div class="attachment-item">
            ${isImageAttachment(a.type)
                ? `<img src="${a.dataUrl}" onclick="openAttachmentLightbox('${a.dataUrl}','${escapeHtml(a.name)}','${a.type}')">`
                : `<div class="file-badge" onclick="openAttachmentLightbox('${a.dataUrl}','${escapeHtml(a.name)}','${a.type}')"><i data-lucide="file-text"></i>${escapeHtml(a.name)}</div>`}
            <button type="button" class="attachment-remove" title="Hapus" onclick="removeRequestAttachment('${a.id}')">&times;</button>
            <div class="attachment-replace" onclick="triggerReplaceAttachment('${a.id}')">Ganti</div>
        </div>`).join('');
    if (window.lucide) lucide.createIcons();
}
// Menghapus 1 lampiran dari daftar yang sedang di-compose.
function removeRequestAttachment(attId) {
    pendingRequestAttachments = pendingRequestAttachments.filter(a => a.id !== attId);
    renderRequestAttachmentPreview();
}
// Membuka file picker untuk mengganti 1 lampiran tertentu (dipakai tombol "Ganti").
function triggerReplaceAttachment(attId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,application/pdf';
    input.onchange = (e) => { if (e.target.files[0]) addValidatedAttachment(e.target.files[0], attId); };
    input.click();
}
// Lightbox sederhana: gambar ditampilkan penuh di dalam modal; PDF dibuka di tab baru karena
// data URL PDF tidak selalu tampil bagus di dalam modal kecil.
function openAttachmentLightbox(dataUrl, name, type) {
    if (type === 'application/pdf') { window.open(dataUrl, '_blank'); return; }
    openModal(name, `<img src="${dataUrl}" style="width:100%;border-radius:8px;">`);
}
// Menampilkan semua lampiran sebuah pengajuan yang sudah tersimpan, dalam modal read-only
// (tanpa opsi hapus/ganti - itu hanya tersedia saat compose sebelum submit).
function viewRequestAttachments(reqId) {
    const db = getDB();
    const r = db.requests.find(x => x.id === reqId);
    if (!r || !r.attachments || !r.attachments.length) return;
    const grid = r.attachments.map(a => `
        <div class="attachment-item" style="width:110px;height:110px;">
            ${isImageAttachment(a.type)
                ? `<img src="${a.dataUrl}" onclick="openAttachmentLightbox('${a.dataUrl}','${escapeHtml(a.name)}','${a.type}')">`
                : `<div class="file-badge" onclick="openAttachmentLightbox('${a.dataUrl}','${escapeHtml(a.name)}','${a.type}')"><i data-lucide="file-text"></i>${escapeHtml(a.name)}</div>`}
        </div>`).join('');
    openModal('Lampiran - ' + (r.customNo || r.id), `<div class="attachment-grid">${grid}</div>`);
    if (window.lucide) lucide.createIcons();
}
// Menyimpan pengajuan pembelian baru dengan status 'pending'.
function submitRequestForm(e) {
    e.preventDefault();
    const db = getDB();
    db.requests.push({
        id: uid('req'),
        customNo: document.getElementById('r-customno').value.trim(),
        itemCode: document.getElementById('r-itemcode').value.trim(),
        itemName: document.getElementById('r-name').value.trim(),
        qty: Number(document.getElementById('r-qty').value),
        estPrice: Number(document.getElementById('r-price').value) || 0,
        reason: document.getElementById('r-reason').value.trim(),
        attachments: pendingRequestAttachments,
        requestedBy: currentUser().name, date: todayStr(), status: 'pending'
    });
    pendingRequestAttachments = [];
    saveDB(db);
    closeModal();
    toast('Pengajuan pembelian berhasil dikirim.');
    renderPage('requests');
    renderSidebar();
}
// Admin menyetujui atau menolak sebuah pengajuan pembelian (Manajemen tidak melakukan persetujuan).
function updateRequestStatus(reqId, status) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB();
    const r = db.requests.find(x => x.id === reqId);
    r.status = status;
    r.approvedBy = currentUser().name;
    r.decisionDate = todayStr();
    saveDB(db);
    toast(status === 'disetujui' ? 'Pengajuan disetujui.' : 'Pengajuan ditolak.', status === 'disetujui' ? 'success' : 'warning');
    renderPage('requests');
    renderSidebar();
}
// Cetak form pengajuan pembelian untuk diajukan ke level lebih atas
function printRequest(reqId) {
    const db = getDB();
    const r = db.requests.find(x => x.id === reqId);
    if (!r) return;
    const html = `
        <div style="text-align:center;margin-bottom:24px;">
            <h2 style="margin-bottom:4px;">FORM PENGAJUAN PEMBELIAN BARANG</h2>
            <p style="color:#555;">GudangKita - Sistem Manajemen Stok & Peminjaman</p>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr><td style="padding:6px 0;width:200px;"><strong>No. Pengajuan</strong></td><td>: ${escapeHtml(r.customNo || r.id)}</td></tr>
            <tr><td style="padding:6px 0;"><strong>Tanggal Pengajuan</strong></td><td>: ${fmtDate(r.date)}</td></tr>
            <tr><td style="padding:6px 0;"><strong>Diajukan Oleh</strong></td><td>: ${escapeHtml(r.requestedBy)}</td></tr>
            ${r.itemCode ? `<tr><td style="padding:6px 0;"><strong>Kode Barang</strong></td><td>: ${escapeHtml(r.itemCode)}</td></tr>` : ''}
            <tr><td style="padding:6px 0;"><strong>Nama Barang</strong></td><td>: ${escapeHtml(r.itemName)}</td></tr>
            <tr><td style="padding:6px 0;"><strong>Jumlah</strong></td><td>: ${r.qty}</td></tr>
            <tr><td style="padding:6px 0;"><strong>Perkiraan Harga</strong></td><td>: ${r.estPrice ? fmtRupiah(r.estPrice) : '-'}</td></tr>
            <tr><td style="padding:6px 0;vertical-align:top;"><strong>Alasan / Keterangan</strong></td><td>: ${escapeHtml(r.reason)}</td></tr>
            <tr><td style="padding:6px 0;"><strong>Status</strong></td><td>: ${r.status === 'disetujui' ? 'DISETUJUI' : r.status === 'ditolak' ? 'DITOLAK' : 'MENUNGGU PERSETUJUAN'}</td></tr>
            ${r.approvedBy ? `<tr><td style="padding:6px 0;"><strong>Diputuskan Oleh</strong></td><td>: ${escapeHtml(r.approvedBy)} (${fmtDate(r.decisionDate)})</td></tr>` : ''}
        </table>
        ${r.attachments && r.attachments.length ? `
        <div style="margin:20px 0;">
            <p><strong>Lampiran Pendukung:</strong></p>
            ${r.attachments.map(a => isImageAttachment(a.type)
                ? `<img src="${a.dataUrl}" style="max-width:300px;max-height:220px;border:1px solid #000;margin:6px 10px 6px 0;">`
                : `<p style="margin:4px 0;">&#128206; ${escapeHtml(a.name)} <span style="color:#777;">(dokumen PDF, lihat file terpisah)</span></p>`
            ).join('')}
        </div>` : ''}
        <table style="width:100%;margin-top:60px;border-collapse:collapse;">
            <tr>
                <td style="width:33%;text-align:center;">Diajukan oleh,<br><br><br><br>(...........................)</td>
                <td style="width:33%;text-align:center;">Diperiksa Admin,<br><br><br><br>(...........................)</td>
                <td style="width:33%;text-align:center;">Disetujui Manajemen,<br><br><br><br>(...........................)</td>
            </tr>
        </table>
    `;
    document.getElementById('print-area').innerHTML = html;
    window.print();
}

/* =========================================================
   BARANG RUSAK / MT
   ========================================================= */
function renderDamagesPage() {
    if (!hasRole('admin', 'manajemen')) return `<p class="text-muted">Anda tidak memiliki akses ke halaman ini.</p>`;
    const db = getDB();
    const F = filterState('damages');
    const rows = db.damages
        .filter(d => dateMatches(F, d.date) && (!F.st || (d.status || 'menunggu') === F.st)
            && queryMatches(F.q, [d.code, d.itemName, d.itemId, d.description, d.lastLocation, d.reportedBy]))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    // Jumlah barang yang sedang berstatus "Perlu Maintenance (MT)" dan belum selesai/permanen (masih dalam masa maintenance).
    const mtQty = db.damages
        .filter(d => d.type === 'mt' && d.status !== 'selesai' && d.status !== 'permanen' && d.status !== 'hilang_permanen')
        .reduce((sum, d) => sum + Number(d.qty || 0), 0);
    return `
    <div class="page-header">
        <p>Catatan barang rusak / perlu maintenance, baik dari pengembalian pinjaman maupun laporan langsung.</p>
        ${hasRole(...ROLE_ADM) ? `<button class="btn btn-primary" onclick="openDamageForm()"><i data-lucide="plus"></i>Catat Barang Rusak/MT</button>` : ''}
    </div>
    <div class="card-grid">
        <div class="stat-card">
            <div class="stat-icon warning"><i data-lucide="wrench"></i></div>
            <div><div class="stat-value">${mtQty}</div><div class="stat-label">Jumlah Barang Dalam Maintenance</div></div>
        </div>
    </div>
    ${filterBar('damages', { placeholder: 'Cari ID Form / barang / kronologi', years: yearOptions(db.damages.map(d => d.date)),
        extra: filterSelect('damages', 'st', [['menunggu', 'Menunggu'], ['proses', 'Diproses'], ['selesai', 'Selesai Diperbaiki'], ['permanen', 'Rusak Permanen'], ['hilang_permanen', 'Benar-benar Hilang']], 'Semua status') })}
    ${rcList(rows.map(d => rcCard({
        key: 'dm:' + d.id,
        chip: fmtDate(d.date),
        badges: d.type === 'mt' ? '<span class="badge badge-warning">Maintenance</span>' + damageStatusBadge(d.status)
            : '<span class="badge badge-danger">Rusak Permanen</span>',
        title: d.itemName,
        left: d.source === 'pengembalian' ? 'Pengembalian' : 'Laporan Langsung',
        right: d.lastLocation || '-',
        count: d.qty + ' unit',
        icon: 'package',
        detail: rcFacts([['ID Form', d.code || '-'], ['Jumlah', d.qty], ['Kronologi', d.description || '-'], ['Lokasi terakhir', d.lastLocation || '-'],
                         ['Sumber', d.source === 'pengembalian' ? 'Pengembalian' : 'Laporan Langsung'], ['Dilaporkan oleh', d.reportedBy]]),
        actions: (hasRole(...ROLE_ADM) && d.type === 'mt' && d.status !== 'selesai' && d.status !== 'permanen' && d.status !== 'hilang_permanen') ? `<select onchange="updateDamageStatus('${d.id}', this.value)" class="rc-select" aria-label="Ubah status">
                <option value="">Ubah status...</option>
                <option value="proses">Sedang Diproses</option>
                <option value="selesai">Selesai Diperbaiki (kembali ke stok)</option>
                <option value="rusak_permanen">Tidak Bisa Diperbaiki (Rusak Permanen)</option>
                <option value="hilang_permanen">Ternyata Benar-benar Hilang</option>
            </select>` : ''
    })), 'Tidak ada catatan barang rusak/MT.')}`;
}
// Memetakan status catatan barang rusak/MT menjadi label badge berwarna.
function damageStatusBadge(s) {
    if (s === 'selesai') return '<span class="badge badge-success">Selesai Diperbaiki</span>';
    if (s === 'proses') return '<span class="badge badge-info">Diproses</span>';
    if (s === 'permanen') return '<span class="badge badge-danger">Rusak Permanen</span>';
    if (s === 'hilang_permanen') return '<span class="badge badge-danger">Benar-benar Hilang</span>';
    return '<span class="badge badge-warning">Menunggu</span>';
}
// Membuka form untuk mencatat langsung barang yang rusak/perlu maintenance (di luar proses pengembalian pinjaman).
function openDamageForm() {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const options = db.items.map(i => `<option value="${i.id}">${escapeHtml(itemLabel(i))}</option>`).join('');
    openModal('Catat Barang Rusak / MT', `
        <form id="damage-form" onsubmit="submitDamageForm(event)">
            <div class="form-group"><label>Barang</label><select id="d-item" required>${options}</select></div>
            <div class="form-row">
                <div class="form-group"><label>Jumlah</label><input type="number" id="d-qty" min="1" value="1" required></div>
                <div class="form-group"><label>Jenis</label>
                    <select id="d-type" required><option value="rusak">Rusak Permanen (tidak bisa diperbaiki / dipakai lagi)</option><option value="mt">Maintenance / MT (masih bisa diperbaiki)</option></select>
                </div>
            </div>
            <div class="form-group"><label>Kronologi Kerusakan</label><textarea id="d-desc" required></textarea></div>
            <div class="form-group"><label>Lokasi Terakhir Terlihat (opsional)</label><input type="text" id="d-location"></div>
            <button type="submit" class="btn btn-primary btn-block">Simpan Catatan</button>
        </form>
    `);
}
// Menyimpan laporan rusak/MT langsung dan memindahkan jumlah barang tersebut dari stok baik ke catatan rusak/MT.
function submitDamageForm(e) {
    e.preventDefault();
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const item = db.items.find(i => i.id === document.getElementById('d-item').value);
    const qty = Number(document.getElementById('d-qty').value);
    if (item && item.stock >= qty) item.stock -= qty; // pindahkan dari stok baik ke catatan rusak/MT
    db.damages.push({
        id: uid('dmg'), itemId: item.id, itemName: itemLabel(item), qty,
        type: document.getElementById('d-type').value,
        description: document.getElementById('d-desc').value.trim(),
        lastLocation: document.getElementById('d-location').value.trim(),
        source: 'laporan langsung', reportedBy: currentUser().name, date: todayStr(),
        // Rusak = permanen (langsung final, tidak ada proses perbaikan); MT = menunggu perbaikan.
        status: document.getElementById('d-type').value === 'rusak' ? 'permanen' : 'menunggu'
    });
    saveDB(db);
    closeModal();
    toast('Catatan barang rusak/MT disimpan.', 'warning');
    renderPage('damages');
}
// Memperbarui status penanganan sebuah catatan barang rusak/MT (menunggu/diproses/selesai/hilang_permanen).
// "Selesai Diperbaiki" -> jumlah barang dikembalikan ke stok. "Ternyata Benar-benar Hilang" -> dipindah ke modul Barang Hilang.
function updateDamageStatus(id, status) {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    if (!status) return;
    const db = getDB();
    const d = db.damages.find(x => x.id === id);
    if (status === 'selesai') {
        const item = db.items.find(i => i.id === d.itemId);
        if (item) item.stock += d.qty;
    } else if (status === 'hilang_permanen') {
        db.lost.push({
            id: uid('lost'), itemId: d.itemId, itemName: d.itemName, qty: d.qty,
            lastLocation: d.lastLocation || '', description: d.description || '',
            source: 'barang rusak/mt', date: todayStr(), reportedBy: currentUser().name, status: 'writeoff'
        });
    } else if (status === 'rusak_permanen') {
        // MT yang ternyata tidak bisa diperbaiki: klasifikasi berubah menjadi Rusak Permanen (final).
        d.type = 'rusak';
        status = 'permanen';
    }
    d.status = status;
    saveDB(db);
    renderPage('damages');
    toast('Status diperbarui.');
}

/* =========================================================
   BARANG HILANG (identifikasi)
   ========================================================= */
function renderLostPage() {
    if (!hasRole('admin', 'manajemen')) return `<p class="text-muted">Anda tidak memiliki akses ke halaman ini.</p>`;
    const db = getDB();
    const F = filterState('lost');
    const rows = db.lost
        .filter(l => dateMatches(F, l.date) && (!F.st || l.status === F.st)
            && queryMatches(F.q, [l.code, l.itemName, l.itemId, l.description, l.lastLocation, l.reportedBy]))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    // Jumlah barang hilang yang statusnya sudah "Ditemukan" (berhasil ditemukan kembali).
    const foundQty = db.lost
        .filter(l => l.status === 'ditemukan')
        .reduce((sum, l) => sum + Number(l.qty || 0), 0);
    return `
    <div class="page-header">
        <p>Identifikasi dan catat barang yang hilang dari gudang. Tidak memerlukan persetujuan Manajemen; setiap perubahan status tercatat di Riwayat Aktivitas.</p>
        ${hasRole(...ROLE_ADM) ? `<button class="btn btn-primary" onclick="openLostForm()"><i data-lucide="plus"></i>Laporkan Barang Hilang</button>` : ''}
    </div>
    <div class="card-grid">
        <div class="stat-card">
            <div class="stat-icon success"><i data-lucide="search-check"></i></div>
            <div><div class="stat-value">${foundQty}</div><div class="stat-label">Jumlah Ditemukan</div></div>
        </div>
    </div>
    ${filterBar('lost', { placeholder: 'Cari ID Form / barang / keterangan', years: yearOptions(db.lost.map(l => l.date)),
        extra: filterSelect('lost', 'st', [['dicari', 'Sedang Dicari'], ['ditemukan', 'Ditemukan'], ['writeoff', 'Benar-benar Hilang (Write-off)']], 'Semua status') })}
    ${rcList(rows.map(l => rcCard({
        key: 'ls:' + l.id,
        chip: fmtDate(l.date),
        badges: lostStatusBadge(l.status),
        title: l.itemName,
        left: l.reportedBy,
        right: l.lastLocation || '-',
        count: l.qty + ' unit',
        icon: 'package',
        detail: rcFacts([['ID Form', l.code || '-'], ['Jumlah hilang', l.qty], ['Jumlah ditemukan', l.status === 'ditemukan' ? l.qty : '-'],
                         ['Lokasi terakhir', l.lastLocation || '-'], ['Keterangan identifikasi', l.description || '-'], ['Dilaporkan oleh', l.reportedBy]]),
        actions: !hasRole(...ROLE_ADM) ? '' : `<select onchange="updateLostStatus('${l.id}', this.value)" class="rc-select" aria-label="Ubah status">
                <option value="dicari" ${l.status === 'dicari' ? 'selected' : ''}>Sedang Dicari</option>
                <option value="ditemukan" ${l.status === 'ditemukan' ? 'selected' : ''}>Ditemukan</option>
                <option value="writeoff" ${l.status === 'writeoff' ? 'selected' : ''}>Benar-benar Hilang (Write-off)</option>
            </select>`
    })), 'Tidak ada laporan barang hilang.')}`;
}
// Memetakan status laporan barang hilang menjadi badge berwarna.
function lostStatusBadge(s) {
    if (s === 'ditemukan') return '<span class="badge badge-success">Ditemukan</span>';
    if (s === 'writeoff') return '<span class="badge badge-danger">Write-off</span>';
    return '<span class="badge badge-info">Sedang Dicari</span>';
}
// Membuka form untuk melaporkan langsung barang yang hilang (di luar proses pengembalian pinjaman).
function openLostForm() {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const options = db.items.map(i => `<option value="${i.id}">${escapeHtml(itemLabel(i))}</option>`).join('');
    openModal('Laporkan Barang Hilang', `
        <form id="lost-form" onsubmit="submitLostForm(event)">
            <div class="form-group"><label>Barang</label><select id="l-item" required>${options}</select></div>
            <div class="form-row">
                <div class="form-group"><label>Jumlah</label><input type="number" id="l-qty" min="1" value="1" required></div>
                <div class="form-group"><label>Lokasi Terakhir Terlihat</label><input type="text" id="l-location"></div>
            </div>
            <div class="form-group"><label>Keterangan Identifikasi</label><textarea id="l-desc" placeholder="ciri-ciri barang, dugaan penyebab hilang, dsb." required></textarea></div>
            <button type="submit" class="btn btn-primary btn-block">Simpan Laporan</button>
        </form>
    `);
}
// Menyimpan laporan barang hilang langsung dan memindahkan jumlah barang tersebut dari stok baik ke daftar barang hilang.
function submitLostForm(e) {
    e.preventDefault();
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const item = db.items.find(i => i.id === document.getElementById('l-item').value);
    const qty = Number(document.getElementById('l-qty').value);
    if (item && item.stock >= qty) item.stock -= qty;
    db.lost.push({
        id: uid('lost'), itemId: item.id, itemName: itemLabel(item), qty,
        lastLocation: document.getElementById('l-location').value.trim(),
        description: document.getElementById('l-desc').value.trim(),
        reportedBy: currentUser().name, date: todayStr(), status: 'dicari'
    });
    saveDB(db);
    closeModal();
    toast('Laporan barang hilang disimpan.', 'warning');
    renderPage('lost');
}
// Memperbarui status pencarian sebuah barang yang hilang (dicari/ditemukan/write-off).
// Untuk "Ditemukan", jumlahnya bisa ditentukan lewat modal (bisa jadi cuma sebagian yang ketemu).
function updateLostStatus(id, status) {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    if (status === 'ditemukan') { openFoundQtyModal(id); return; }
    const db = getDB();
    const l = db.lost.find(x => x.id === id);
    l.status = status;
    saveDB(db);
    toast('Status barang hilang diperbarui.');
    renderPage('lost');
}
// Membuka modal kecil untuk menentukan berapa jumlah barang yang berhasil ditemukan (bisa sebagian dari total hilang),
// dan menentukan status sisanya (masih dicari, atau benar-benar hilang/write-off).
function openFoundQtyModal(id) {
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const l = db.lost.find(x => x.id === id);
    if (!l) return;
    openModal(`Barang Ditemukan: ${escapeHtml(l.itemName)}`, `
        <form id="found-qty-form" onsubmit="submitFoundQty(event, '${id}')">
            <p class="text-muted" style="margin-bottom:12px;">Total yang dilaporkan hilang: <strong>${l.qty}</strong>. Masukkan berapa yang berhasil ditemukan.</p>
            <div class="form-group">
                <label>Jumlah Ditemukan</label>
                <input type="number" id="found-qty-input" min="1" max="${l.qty}" value="${l.qty}" oninput="toggleFoundRemainderField(${l.qty})" required>
            </div>
            <div class="form-group" id="found-remainder-field">
                <label>Status Sisa yang Belum Ditemukan</label>
                <select id="found-remainder-status">
                    <option value="dicari">Masih Dicari</option>
                    <option value="writeoff">Benar-benar Hilang (Write-off)</option>
                </select>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Konfirmasi Ditemukan</button>
        </form>
    `);
    toggleFoundRemainderField(l.qty);
}
// Menampilkan/menyembunyikan pilihan status sisa hanya jika jumlah ditemukan masih kurang dari total yang hilang.
function toggleFoundRemainderField(totalQty) {
    const input = document.getElementById('found-qty-input');
    const field = document.getElementById('found-remainder-field');
    if (!input || !field) return;
    const found = Number(input.value) || 0;
    field.classList.toggle('hidden', found >= totalQty);
}
// Memproses konfirmasi jumlah ditemukan: kembalikan jumlah tsb ke stok. Sisa yang belum ditemukan (jika ada)
// dicatat sesuai pilihan: tetap "Sedang Dicari", atau langsung "Benar-benar Hilang (Write-off)".
function submitFoundQty(e, id) {
    e.preventDefault();
    if (!requireRole(ROLE_ADM, 'Admin atau Manajemen')) return;
    const db = getDB();
    const l = db.lost.find(x => x.id === id);
    if (!l) return;
    let qtyFound = Number(document.getElementById('found-qty-input').value) || 0;
    qtyFound = Math.max(0, Math.min(qtyFound, l.qty));
    if (qtyFound <= 0) { closeModal(); return; }
    const item = db.items.find(i => i.id === l.itemId);
    if (item) item.stock += qtyFound;
    const qtyRemaining = l.qty - qtyFound;
    if (qtyRemaining > 0) {
        const remainderStatus = document.getElementById('found-remainder-status').value;
        // Penemuan sebagian dicatat eksplisit di riwayat (jumlah di record asli berubah, status bisa tetap sama).
        addLog(db, {
            ref: l.code, recId: l.id, coll: 'lost', eventCode: '', date: todayStr(),
            title: COLLECTIONS.lost.label + ': ' + l.itemName + ' (' + l.qty + ')', status: remainderStatus,
            note: 'Ditemukan sebagian: ' + qtyFound + ' dari ' + l.qty + ' unit. Sisa ' + qtyRemaining + ' unit berstatus ' + (remainderStatus === 'writeoff' ? 'Write-off' : 'Masih Dicari') + '.',
            event: '', who: l.reportedBy || '', items: [{ name: l.itemName || '-', qty: l.qty }],
            action: 'ditemukan sebagian: ' + qtyFound + ' unit'
        });
        l.qty = qtyRemaining; // sisanya tetap tercatat, statusnya sesuai pilihan (dicari / write-off)
        l.status = remainderStatus;
        db.lost.push({
            id: uid('lost'), itemId: l.itemId, itemName: l.itemName, qty: qtyFound,
            lastLocation: l.lastLocation, description: l.description,
            reportedBy: l.reportedBy, date: todayStr(), status: 'ditemukan'
        });
    } else {
        l.status = 'ditemukan';
    }
    saveDB(db);
    closeModal();
    toast('Barang ditemukan & stok diperbarui.');
    renderPage('lost');
}

/* =========================================================
   BARANG HABIS PAKAI / ATK
   Tidak memerlukan ACC Manajemen. Admin mencatat pemakaian; Manajemen hanya dapat melihat (read-only).
   Stok berkurang otomatis untuk status Habis Terpakai / Hilang dan semuanya tercatat di riwayat.
   ========================================================= */
// Kondisi pemakaian -> status barang ATK.
const ATK_LEVELS = {
    separuh:            { label: 'Separuh',            st: 'tersedia', badge: 'badge-info' },
    setengah_pemakaian: { label: 'Setengah Pemakaian', st: 'tersedia', badge: 'badge-warning' },
    habis_pakai:        { label: 'Habis Terpakai',     st: 'habis',    badge: 'badge-danger' },
    hilang:             { label: 'Hilang',             st: 'hilang',   badge: 'badge-danger' }
};
const ATK_STATUS = { tersedia: 'Tersedia', habis: 'Habis Terpakai', hilang: 'Hilang' };
let atkTab = 'catatan';
let pendingConsumablePhotoData = null; // foto bukti yang sedang disiapkan di form
const atkLevelOf = r => ATK_LEVELS[r.level] || { label: '-', st: 'tersedia', badge: 'badge-muted' };

function setAtkTab(tab) { atkTab = tab; renderPage('consumables'); }
function atkBadge(c) {
    const a = atkLevelOf(c);
    return `<span class="badge ${a.st === 'tersedia' ? 'badge-success' : 'badge-danger'}">${ATK_STATUS[a.st]}</span>`
        + (a.st === 'tersedia' ? ` <span class="badge ${a.badge}">${a.label}</span>` : '');
}
function filteredAtkRecords() {
    const F = filterState('atk');
    return getDB().consumables.filter(c => dateMatches(F, c.date) && (!F.st || atkLevelOf(c).st === F.st)
        && queryMatches(F.q, [c.code, c.itemName, c.itemId, c.reportedBy, c.reason, c.note]))
        .sort((a, b) => (b.date + (b.code || '')).localeCompare(a.date + (a.code || '')));
}
function renderConsumablesPage() {
    const db = getDB(), F = filterState('atk');
    const canReport = hasRole('admin'), isAdmin = hasRole('admin');
    const header = `<div class="page-header page-header-end">
            ${canReport ? `<button class="btn btn-primary" onclick="openConsumableForm()"><i data-lucide="plus"></i>Laporkan Pemakaian</button>`
                        : '<span class="badge badge-info">Mode lihat saja (Read Only)</span>'}
        </div>
        <div class="tabs">
            <button class="tab-btn ${atkTab === 'catatan' ? 'active' : ''}" onclick="setAtkTab('catatan')">Catatan Pemakaian</button>
            <button class="tab-btn ${atkTab === 'riwayat' ? 'active' : ''}" onclick="setAtkTab('riwayat')">Riwayat Transaksi</button>
        </div>`;
    if (atkTab === 'riwayat') {
        const logs = db.activityLog.filter(a => a.coll === 'consumables' && dateMatches(F, a.date)
            && queryMatches(F.q, [a.ref, a.title, a.who, a.user, a.note])).sort((a, b) => b.ts.localeCompare(a.ts));
        return header + filterBar('atk', { placeholder: 'Cari ID / barang / pengguna', years: yearOptions(db.activityLog.map(a => a.date)) })
            + rcList(logs.map(a => rcCard({
                key: 'atl:' + a.id,
                chip: fmtDateTime(a.ts),
                badges: statusBadge(a.status),
                title: a.title,
                left: a.who || a.user,
                right: a.ref,
                main: `atkDetailByRef('${escapeHtml(a.ref)}')`,
                extra: `<p class="rc-note">${escapeHtml(a.action)}${a.note ? ' · ' + escapeHtml(a.note) : ''}</p>`
            })), 'Belum ada riwayat transaksi.');
    }
    const rows = filteredAtkRecords();
    return header + filterBar('atk', { placeholder: 'Cari ID / barang / pelapor', years: yearOptions(db.consumables.map(c => c.date)),
            extra: filterSelect('atk', 'st', Object.entries(ATK_STATUS), 'Semua status') })
        + rcList(rows.map(c => rcCard({
            key: 'atk:' + c.id,
            chip: fmtDate(c.date),
            badges: atkBadge(c) + (c.status === 'menunggu' ? '<span class="badge badge-warning">Menunggu ACC Admin</span>' : c.status === 'ditolak' ? '<span class="badge badge-danger">Ditolak</span>' : ''),
            title: c.itemName,
            left: c.reportedBy || '-',
            right: c.code || '-',
            count: c.qty + ' unit',
            icon: 'package',
            detail: rcFacts([['ID Transaksi', c.code || '-'], ['ID Barang', c.itemId], ['Jumlah', c.qty], ['Alasan / catatan', c.reason || c.note || '-'], ['Pelapor', c.reportedBy || '-'],
                             ['Foto', c.photo ? { html: thumbHtml(c.photo) } : '']]),
            actions: `<button class="btn btn-sm btn-secondary" onclick="atkDetail('${c.id}')"><i data-lucide="eye"></i>Detail</button>`
                + (isAdmin && c.status === 'menunggu' ? `<button class="btn btn-sm btn-success" onclick="updateConsumableStatus('${c.id}','disetujui')"><i data-lucide="check"></i>Setujui</button><button class="btn btn-sm btn-danger" onclick="updateConsumableStatus('${c.id}','ditolak')"><i data-lucide="x"></i>Tolak</button>` : '')
        })), 'Belum ada catatan pemakaian.');
}
function atkDetailByRef(ref) {
    const c = getDB().consumables.find(x => x.code === ref);
    if (c) atkDetail(c.id);
}
function atkDetail(id) {
    const db = getDB(), c = db.consumables.find(x => x.id === id);
    if (!c) return;
    const logs = db.activityLog.filter(a => a.ref === c.code).sort((a, b) => a.ts.localeCompare(b.ts));
    openModal('Detail ATK ' + (c.code || ''), `<div class="detail-grid">
        <div><label>ID Transaksi</label><b>${escapeHtml(c.code || '-')}</b></div><div><label>Tanggal</label>${fmtDate(c.date)}</div>
        <div><label>Barang</label>${escapeHtml(c.itemName)} (${escapeHtml(c.itemId || '-')})</div><div><label>Jumlah</label>${c.qty}</div>
        <div><label>Status</label>${atkBadge(c)}</div><div><label>Nama pengguna</label>${escapeHtml(c.reportedBy || '-')}</div>
        <div><label>Sumber</label>${c.source === 'pengembalian' ? 'Pengembalian pinjaman' : 'Laporan langsung'}</div>
        ${c.stockBefore !== undefined ? `<div><label>Stok sebelum → sesudah</label>${c.stockBefore} → ${c.stockAfter}</div>` : ''}</div>
        <p><label>Alasan penggunaan</label>${escapeHtml(c.reason || '-')}</p>
        ${c.chronology ? `<p><label>Kronologi kehilangan</label>${escapeHtml(c.chronology)}${c.lastLocation ? '<br>Lokasi terakhir: ' + escapeHtml(c.lastLocation) : ''}</p>` : ''}
        <p><label>Catatan tambahan</label>${escapeHtml(c.note || '-')}</p>
        ${c.photo ? `<p><label>Foto</label>${thumbHtml(c.photo)}</p>` : ''}
        <h4>Riwayat transaksi</h4><ul class="rv-log">${logs.map(a => `<li>${fmtDateTime(a.ts)} · ${escapeHtml(a.action)} · ${escapeHtml(a.user)}</li>`).join('') || '<li>-</li>'}</ul>`);
}
function openConsumableForm() {
    if (!hasRole('admin')) { toast('Hanya Admin yang dapat mencatat pemakaian ATK. Manajemen hanya dapat melihat.', 'danger'); return; }
    const items = getDB().items.filter(i => i.isConsumable);
    pendingConsumablePhotoData = null;
    if (!items.length) { toast('Belum ada barang yang ditandai sebagai Barang Habis Pakai/ATK di Data Barang.', 'warning'); return; }
    openModal('Laporkan Pemakaian ATK', `<form id="consumable-form" onsubmit="submitConsumableForm(event)">
        <div class="form-group"><label>Barang</label><select id="c-item" onchange="atkStockInfo()" required>${items.map(i => `<option value="${i.id}">[${escapeHtml(i.id)}] ${escapeHtml(itemLabel(i))}</option>`).join('')}</select><small id="c-stock-info" class="text-muted"></small></div>
        <div class="form-row">
            <div class="form-group"><label>Jumlah</label><input type="number" id="c-qty" min="1" value="1" required></div>
            <div class="form-group"><label>Status / Kondisi</label><select id="c-level" onchange="toggleConsumablePhoto()" required>
                <option value="separuh">Tersedia · Separuh</option><option value="setengah_pemakaian">Tersedia · Setengah Pemakaian</option>
                <option value="habis_pakai">Habis Terpakai</option><option value="hilang">Hilang</option></select></div></div>
        <div class="form-group"><label id="c-reason-label">Alasan penggunaan</label><input type="text" id="c-reason" placeholder="Contoh: dipakai untuk packing event"></div>
        <div id="c-chrono-wrap" class="hidden"><div class="form-group"><label>Kronologi kehilangan <span class="text-danger">(wajib)</span></label><textarea id="c-chrono" rows="3"></textarea></div>
            <div class="form-group"><label>Lokasi terakhir terlihat</label><input type="text" id="c-lastloc"></div></div>
        <div class="form-group"><label id="c-photo-label">Foto Bukti (opsional)</label>
            <div class="upload-options">
                <div class="upload-box" onclick="document.getElementById('c-photo-file').click()"><i data-lucide="upload"></i><div>Unggah dari galeri</div></div>
                <div class="upload-box" onclick="openCameraCapture(setAtkPhoto,'Ambil Foto Bukti')"><i data-lucide="camera"></i><div>Ambil foto langsung</div></div></div>
            <input type="file" id="c-photo-file" accept="image/png,image/jpeg,image/webp" class="hidden" onchange="previewConsumablePhoto(event)">
            <img id="c-photo-preview" class="upload-preview hidden"></div>
        <div class="form-group"><label>Catatan tambahan (opsional)</label><textarea id="c-note"></textarea></div>
        <p class="text-muted" style="margin-bottom:12px;">Tidak perlu persetujuan Manajemen. Stok berkurang otomatis untuk status Habis Terpakai / Hilang dan tercatat di riwayat.</p>
        <button type="submit" class="btn btn-primary btn-block">Simpan Laporan</button></form>`);
    atkStockInfo();
    toggleConsumablePhoto();
}
const fieldValue = id => (document.getElementById(id) || { value: '' }).value.trim();
function atkStockInfo() {
    const item = getDB().items.find(i => i.id === fieldValue('c-item')), el = document.getElementById('c-stock-info');
    if (el) el.textContent = item ? 'Stok saat ini: ' + item.stock + ' ' + (item.unit || '') : '';
}
// Menyesuaikan label/field form sesuai kondisi yang dipilih (foto wajib untuk Habis Terpakai, kronologi untuk Hilang).
function toggleConsumablePhoto() {
    const level = fieldValue('c-level'), st = (ATK_LEVELS[level] || {}).st, needsReason = st && st !== 'tersedia';
    const setHtml = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
    setHtml('c-photo-label', level === 'habis_pakai' ? 'Foto Bukti <span class="text-danger">(wajib untuk Habis Terpakai)</span>' : 'Foto Bukti (opsional)');
    setHtml('c-reason-label', needsReason ? 'Alasan penggunaan <span class="text-danger">(wajib)</span>' : 'Alasan penggunaan (opsional)');
    const wrap = document.getElementById('c-chrono-wrap');
    if (wrap) wrap.classList.toggle('hidden', st !== 'hilang');
}
// Memperkecil foto (maks 1280px, JPEG) supaya penyimpanan tidak cepat penuh.
function shrinkImage(dataUrl, callback) {
    const img = new Image();
    img.onload = () => {
        const ratio = Math.min(1, 1280 / Math.max(img.width, img.height)), canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        callback(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => callback(dataUrl);
    img.src = dataUrl;
}
function setAtkPhoto(dataUrl) {
    shrinkImage(dataUrl, d => {
        pendingConsumablePhotoData = d;
        const img = document.getElementById('c-photo-preview');
        if (img) { img.src = d; img.classList.remove('hidden'); }
    });
}
function previewConsumablePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Format foto harus PNG, JPG, atau WEBP.', 'danger'); e.target.value = ''; return; }
    if (file.size > 8 * 1024 * 1024) { toast('Ukuran foto maksimal 8 MB.', 'danger'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = ev => setAtkPhoto(ev.target.result);
    reader.readAsDataURL(file);
}
function submitConsumableForm(e) {
    e.preventDefault();
    if (!hasRole('admin')) { toast('Hanya Admin yang dapat mencatat pemakaian ATK.', 'danger'); return; }
    const db = getDB(), item = db.items.find(i => i.id === fieldValue('c-item'));
    if (!item || !item.isConsumable) { toast('Barang ATK tidak valid.', 'danger'); return; }
    const level = fieldValue('c-level'), a = ATK_LEVELS[level], qty = Number(fieldValue('c-qty'));
    const reason = fieldValue('c-reason'), chronology = fieldValue('c-chrono');
    if (!a || !(qty >= 1) || Math.floor(qty) !== qty) { toast('Jumlah harus bilangan bulat minimal 1.', 'danger'); return; }
    const reducesStock = a.st !== 'tersedia';
    if (reducesStock && reason.length < 5) { toast('Alasan penggunaan wajib diisi (minimal 5 karakter).', 'danger'); return; }
    if (a.st === 'hilang' && chronology.length < 10) { toast('Kronologi kehilangan wajib diisi (minimal 10 karakter).', 'danger'); return; }
    if (level === 'habis_pakai' && !pendingConsumablePhotoData) { toast('Foto bukti wajib untuk status Habis Terpakai.', 'danger'); return; }
    if (reducesStock && qty > item.stock) { toast('Jumlah melebihi stok tercatat (' + item.stock + ').', 'danger'); return; }
    const before = item.stock;
    if (reducesStock) item.stock -= qty;
    db.consumables.push({
        id: uid('cons'), itemId: item.id, itemName: itemLabel(item), qty, level, status: 'tercatat',
        photo: pendingConsumablePhotoData || '', reason, chronology, lastLocation: fieldValue('c-lastloc'), note: fieldValue('c-note'),
        source: 'laporan langsung', reportedBy: currentUser().name, date: todayStr(), stockBefore: before, stockAfter: item.stock
    });
    if (!saveDB(db)) return;
    closeModal();
    pendingConsumablePhotoData = null;
    toast(reducesStock ? 'Tercatat. Stok ' + item.name + ' berkurang ' + qty + '.' : 'Laporan pemakaian tercatat.', reducesStock ? 'warning' : 'success');
    renderPage('consumables');
    renderSidebar();
}
// Hanya untuk data lama berstatus "menunggu" (sebelum alur tanpa ACC): Admin dapat menyetujui/menolak.
function updateConsumableStatus(id, status) {
    if (!requireRole(['admin'], 'Admin')) return;
    const db = getDB(), c = db.consumables.find(x => x.id === id);
    if (!c || c.status !== 'menunggu') return;
    if (status === 'disetujui') {
        const item = db.items.find(i => i.id === c.itemId);
        if (item && item.stock >= c.qty) { c.stockBefore = item.stock; item.stock -= c.qty; c.stockAfter = item.stock; }
    }
    c.status = status;
    saveDB(db);
    toast(status === 'disetujui' ? 'Disetujui, stok diperbarui.' : 'Laporan ditolak.', status === 'disetujui' ? 'success' : 'warning');
    renderPage('consumables');
}

/* =========================================================
   MANAJEMEN USER (khusus role manajemen)
   ========================================================= */
function renderUsersPage() {
    if (!hasRole('manajemen')) return `<p class="text-muted">Anda tidak memiliki akses ke halaman ini.</p>`;
    const db = getDB();
    return `
    <div class="page-header">
        <p>Kelola akun pengguna sistem (staff, admin, manajemen).</p>
        <button class="btn btn-primary" onclick="openUserForm()"><i data-lucide="plus"></i>Tambah User</button>
    </div>
    ${rcList(db.users.map(u => rcCard({
        key: 'usr:' + u.id,
        badges: roleBadge(u.role) + (DEFAULT_ACCOUNTS.some(d => d.id === u.id) ? '<span class="badge badge-muted">Bawaan</span>' : ''),
        title: u.name,
        left: '@' + u.username,
        actions: `<button class="btn btn-sm btn-secondary" onclick="openUserForm('${u.id}')"><i data-lucide="pencil"></i>Edit</button>`
            + (u.id !== currentUser().id && !DEFAULT_ACCOUNTS.some(d => d.id === u.id) ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')"><i data-lucide="trash-2"></i>Hapus</button>` : '')
    })), 'Belum ada pengguna.')}`;
}
// Memetakan role pengguna menjadi label badge berwarna.
function roleBadge(role) {
    if (role === 'manajemen') return '<span class="badge badge-purple">Manajemen</span>';
    if (role === 'admin') return '<span class="badge badge-info">Admin</span>';
    return '<span class="badge badge-muted">Staff</span>';
}
// Membuka form tambah/edit akun pengguna.
function openUserForm(userId) {
    const db = getDB();
    const u = userId ? db.users.find(x => x.id === userId) : null;
    openModal(u ? 'Edit User' : 'Tambah User', `
        <form id="user-form" onsubmit="submitUserForm(event, '${userId || ''}')">
            <div class="form-group"><label>Nama Lengkap</label><input type="text" id="u-name" value="${u ? escapeHtml(u.name) : ''}" required></div>
            <div class="form-group"><label>Username</label><input type="text" id="u-username" value="${u ? escapeHtml(u.username) : ''}" required></div>
            <div class="form-group"><label>Password ${u ? '(kosongkan jika tidak diubah)' : ''}</label><input type="text" id="u-password" ${u ? '' : 'required'}></div>
            <div class="form-group"><label>Role</label>
                <select id="u-role" required>
                    <option value="staff" ${u && u.role === 'staff' ? 'selected' : ''}>Staff</option>
                    <option value="admin" ${u && u.role === 'admin' ? 'selected' : ''}>Admin</option>
                    <option value="manajemen" ${u && u.role === 'manajemen' ? 'selected' : ''}>Manajemen</option>
                </select>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Simpan</button>
        </form>
    `);
}
// Menyimpan akun pengguna baru atau hasil edit, dengan pengecekan username yang sudah dipakai.
function submitUserForm(e, userId) {
    e.preventDefault();
    const db = getDB();
    const username = document.getElementById('u-username').value.trim();
    const dupe = db.users.find(u => u.username === username && u.id !== userId);
    if (dupe) { toast('Username sudah digunakan.', 'danger'); return; }
    const pass = document.getElementById('u-password').value;
    if (userId) {
        const idx = db.users.findIndex(u => u.id === userId);
        db.users[idx].name = document.getElementById('u-name').value.trim();
        db.users[idx].username = username;
        db.users[idx].role = document.getElementById('u-role').value;
        if (pass) db.users[idx].password = pass;
        toast('User berhasil diperbarui.');
    } else {
        db.users.push({
            id: uid('u'), name: document.getElementById('u-name').value.trim(),
            username, password: pass, role: document.getElementById('u-role').value
        });
        toast('User baru berhasil ditambahkan.');
    }
    saveDB(db);
    closeModal();
    renderPage('users');
}
// Menghapus akun pengguna setelah konfirmasi. Akun bawaan (default) tidak boleh dihapus,
// supaya staff/admin/manajemen selalu bisa login di device manapun.
function deleteUser(userId) {
    if (DEFAULT_ACCOUNTS.some(u => u.id === userId)) {
        toast('Akun bawaan ini tidak bisa dihapus, supaya selalu bisa login di device manapun.', 'warning');
        return;
    }
    if (!confirm('Hapus user ini?')) return;
    const db = getDB();
    db.users = db.users.filter(u => u.id !== userId);
    saveDB(db);
    renderPage('users');
    toast('User dihapus.', 'warning');
}

/* =========================================================
   KAMERA REALTIME (Ambil Foto + Watermark Tanggal/Waktu/Lokasi)
   Modul generik dipakai oleh: form ATK/Consumable, Pengembalian (habis pakai),
   dan Pengajuan Pembelian. Butuh HTTPS (atau localhost) agar getUserMedia/geolocation diizinkan browser.
   ========================================================= */
const ENABLE_REVERSE_GEOCODE = true; // set false jika tidak ingin memanggil layanan geocoding eksternal

let cameraStreamObj = null;
let cameraFacingMode = 'environment'; // default kamera belakang di HP
let cameraHasMultipleDevices = false;
let cameraOnCaptureCallback = null;
let cameraCapturedDataUrl = null;
let cameraGeo = { lat: null, lng: null, accuracy: null, address: null, status: 'Mendeteksi lokasi...' };

// Membuka modal kamera. onCaptureCallback(dataUrl, meta) dipanggil saat user menekan "Gunakan Foto".
// meta berisi { timestamp, lat, lng, address }.
async function openCameraCapture(onCaptureCallback, title) {
    cameraOnCaptureCallback = onCaptureCallback;
    cameraCapturedDataUrl = null;
    cameraGeo = { lat: null, lng: null, accuracy: null, address: null, status: 'Mendeteksi lokasi...' };
    document.getElementById('camera-modal-title').textContent = title || 'Ambil Foto';
    document.getElementById('camera-modal').classList.remove('hidden');
    document.getElementById('camera-captured-preview').classList.add('hidden');
    document.getElementById('camera-live-wrap').classList.remove('hidden');
    document.getElementById('camera-controls-captured').classList.add('hidden');
    document.getElementById('camera-controls-live').classList.remove('hidden');
    if (window.lucide) lucide.createIcons();

    await detectCameraDeviceCount();
    await startCameraStream();
    fetchGeoLocationForCamera(); // berjalan paralel, tidak menunggu sebelum kamera tampil
}
// Mengecek jumlah kamera yang tersedia untuk menentukan apakah tombol "Ganti Kamera" ditampilkan.
async function detectCameraDeviceCount() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        cameraHasMultipleDevices = devices.filter(d => d.kind === 'videoinput').length > 1;
    } catch (err) {
        cameraHasMultipleDevices = true; // fallback: tetap tampilkan tombol ganti kalau gagal deteksi
    }
    document.getElementById('camera-switch-btn').classList.toggle('hidden', !cameraHasMultipleDevices);
}
// Memulai/reset video stream sesuai cameraFacingMode saat ini.
async function startCameraStream() {
    stopCameraStreamTracks();
    try {
        cameraStreamObj = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: cameraFacingMode } },
            audio: false
        });
        const video = document.getElementById('camera-video');
        video.srcObject = cameraStreamObj;
        await video.play();
    } catch (err) {
        toast('Tidak bisa mengakses kamera. Pastikan izin kamera diaktifkan dan situs diakses via HTTPS.', 'danger');
        closeCameraCapture();
    }
}
// Menghentikan seluruh track video aktif (dipanggil sebelum ganti kamera / saat modal ditutup).
function stopCameraStreamTracks() {
    if (cameraStreamObj) {
        cameraStreamObj.getTracks().forEach(t => t.stop());
        cameraStreamObj = null;
    }
}
// Beralih antara kamera depan (user) dan belakang (environment).
function switchCamera() {
    cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    startCameraStream();
}
// Mengambil lokasi GPS realtime. Kalau berhasil & fitur reverse-geocode aktif, coba dapatkan nama alamat.
function fetchGeoLocationForCamera() {
    const statusEl = document.getElementById('camera-geo-status');
    if (!navigator.geolocation) {
        cameraGeo.status = 'Perangkat tidak mendukung GPS.';
        if (statusEl) statusEl.textContent = cameraGeo.status;
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            cameraGeo.lat = pos.coords.latitude;
            cameraGeo.lng = pos.coords.longitude;
            cameraGeo.accuracy = pos.coords.accuracy;
            cameraGeo.status = `Lat ${cameraGeo.lat.toFixed(6)}, Long ${cameraGeo.lng.toFixed(6)}`;
            if (statusEl) statusEl.textContent = cameraGeo.status;
            if (ENABLE_REVERSE_GEOCODE) reverseGeocodeForCamera(cameraGeo.lat, cameraGeo.lng);
        },
        (err) => {
            cameraGeo.status = 'Lokasi tidak tersedia (izin ditolak/GPS mati).';
            if (statusEl) statusEl.textContent = cameraGeo.status;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}
// (Opsional/Bonus) Reverse geocoding via Nominatim (OpenStreetMap, gratis, tanpa API key).
// Untuk pemakaian volume tinggi/produksi, pertimbangkan layanan berbayar (Google Geocoding dll)
// karena Nominatim punya rate limit ketat untuk pemakaian komersial.
async function reverseGeocodeForCamera(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`);
        const data = await res.json();
        if (data && data.display_name) {
            cameraGeo.address = data.display_name;
            const statusEl = document.getElementById('camera-geo-status');
            if (statusEl) statusEl.textContent = cameraGeo.address;
        }
    } catch (err) {
        // gagal reverse geocode -> tetap pakai koordinat, tidak fatal
    }
}
// Mengambil frame video saat ini, membakar watermark (tanggal/waktu/lokasi), menampilkan hasilnya.
function captureCameraPhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawCameraWatermark(ctx, canvas.width, canvas.height);
    cameraCapturedDataUrl = canvas.toDataURL('image/jpeg', 0.9);

    document.getElementById('camera-captured-preview').src = cameraCapturedDataUrl;
    document.getElementById('camera-captured-preview').classList.remove('hidden');
    document.getElementById('camera-live-wrap').classList.add('hidden');
    document.getElementById('camera-controls-live').classList.add('hidden');
    document.getElementById('camera-controls-captured').classList.remove('hidden');
}
// Menggambar overlay watermark (tanggal, jam, lokasi/alamat) di sudut kiri-bawah foto.
function drawCameraWatermark(ctx, w, h) {
    const now = new Date();
    const line1 = now.toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line2 = cameraGeo.address
        ? cameraGeo.address
        : (cameraGeo.lat ? `Lat ${cameraGeo.lat.toFixed(6)}, Long ${cameraGeo.lng.toFixed(6)}` : 'Lokasi tidak tersedia');

    const fontSize = Math.max(14, Math.round(w * 0.022));
    ctx.font = `${fontSize}px Arial`;
    const padding = fontSize * 0.6;
    const lineHeight = fontSize * 1.4;
    const boxHeight = lineHeight * 2 + padding * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - boxHeight, w, boxHeight);

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(line1, padding, h - boxHeight + padding);
    ctx.fillText(line2, padding, h - boxHeight + padding + lineHeight);
}
// Kembali ke mode live preview untuk mengambil ulang foto (stream kamera tetap berjalan).
function retakeCameraPhoto() {
    cameraCapturedDataUrl = null;
    document.getElementById('camera-captured-preview').classList.add('hidden');
    document.getElementById('camera-live-wrap').classList.remove('hidden');
    document.getElementById('camera-controls-captured').classList.add('hidden');
    document.getElementById('camera-controls-live').classList.remove('hidden');
}
// Mengonfirmasi hasil foto: mengirim dataUrl + metadata ke form pemanggil, lalu menutup modal.
function useCapturedCameraPhoto() {
    if (!cameraCapturedDataUrl || !cameraOnCaptureCallback) return;
    cameraOnCaptureCallback(cameraCapturedDataUrl, {
        timestamp: new Date().toISOString(),
        lat: cameraGeo.lat, lng: cameraGeo.lng, address: cameraGeo.address
    });
    closeCameraCapture();
}
// Menutup modal kamera & memastikan stream video dimatikan (penting agar lampu kamera HP tidak menyala terus).
function closeCameraCapture() {
    stopCameraStreamTracks();
    document.getElementById('camera-modal').classList.add('hidden');
    cameraOnCaptureCallback = null;
}
// Menambahkan hasil foto kamera langsung sebagai lampiran Pengajuan Pembelian (tanpa lewat
// FileReader, karena sudah dalam bentuk dataUrl). Tetap dibatasi ATTACHMENT_MAX_COUNT.
function addCapturedPhotoToRequest(dataUrl) {
    if (pendingRequestAttachments.length >= ATTACHMENT_MAX_COUNT) {
        toast(`Maksimal ${ATTACHMENT_MAX_COUNT} lampiran per pengajuan.`, 'warning');
        return;
    }
    const approxSize = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
    pendingRequestAttachments.push({
        id: uid('att'), name: `kamera-${Date.now()}.jpg`, type: 'image/jpeg', size: approxSize, dataUrl
    });
    renderRequestAttachmentPreview();
}

/* =========================================================
   RIWAYAT AKTIVITAS & ID FORM OTOMATIS
   Setiap saveDB() membandingkan data lama vs baru (syncHistory): record baru diberi ID Form,
   perubahan status dicatat ke activityLog, dan notifikasi dibuat untuk role yang berkepentingan.
   ========================================================= */
// Koleksi database -> prefix ID Form + label jenis aktivitas.
const COLLECTIONS = {
    loans:       { prefix: 'FORM-SMI-PJM', label: 'Peminjaman' },
    consumables: { prefix: 'FORM-SMI-ATK', label: 'ATK / Habis Pakai' },
    lost:        { prefix: 'FORM-SMI-MNJ', label: 'Barang Hilang' },
    damages:     { prefix: 'FORM-SMI-MNJ', label: 'Barang Rusak / MT' },
    purchases:   { prefix: 'FORM-SMI-PBL', label: 'Barang Masuk (Pembelian)' },
    requests:    { prefix: 'FORM-SMI-MNJ', label: 'Pengajuan Pembelian' }
};
const FINAL_STATUS = /dikembalikan|selesai/;
const yearOf = d => String(d || new Date().toISOString()).slice(0, 4);

// ID berurutan per prefix+tahun (cth FORM-SMI-2026-0001), tersimpan di db.counters dan tidak pernah direset.
function nextCode(db, prefix, year) {
    const key = prefix + '-' + year;
    db.counters[key] = (db.counters[key] || 0) + 1;
    return key + '-' + String(db.counters[key]).padStart(4, '0');
}
// Menambah satu baris ke riwayat aktivitas.
function addLog(db, entry) {
    Object.keys(entry).forEach(k => { if (entry[k] === undefined) delete entry[k]; });
    const log = Object.assign({
        id: nextCode(db, 'ACT', yearOf(entry.date)), ts: new Date().toISOString(),
        user: (currentUser() || {}).name || 'Sistem'
    }, entry);
    if (isNaN(new Date(log.ts))) log.ts = new Date().toISOString();
    db.activityLog.push(log);
    return log;
}
// Mendeskripsikan sebuah record (loan/atk/dll.) untuk disimpan sebagai baris riwayat.
function describeRecord(coll, r) {
    const eventTag = r.eventName ? ' [Event: ' + r.eventName + ']' : '';
    let status = r.status || r.level || 'tercatat';
    let note = r.notes || r.note || r.description || r.reason || '';
    let title = COLLECTIONS[coll].label + ': ' + (r.itemName || '-') + (r.qty ? ' (' + r.qty + ')' : '') + eventTag;
    if (coll === 'damages') {
        title = (r.type === 'mt' ? 'Maintenance (MT)' : 'Rusak Permanen') + ': ' + (r.itemName || '-') + (r.qty ? ' (' + r.qty + ')' : '');
    }
    if (coll === 'consumables') {
        const a = atkLevelOf(r);
        status = ATK_STATUS[a.st] + (a.st === 'tersedia' ? ' · ' + a.label : '');
        title = 'ATK ' + ATK_STATUS[a.st] + ': ' + (r.itemName || '-') + ' (' + r.qty + ')';
        note = [r.reason, r.chronology, r.note].filter(Boolean).join(' | ');
    }
    return {
        coll, title, status, note, event: r.eventName || '',
        who: r.borrower || r.reportedBy || r.requestedBy || '',
        items: [{ name: r.itemName || '-', qty: r.qty || 0 }]
    };
}
// Membandingkan DB lama vs baru: beri ID, catat riwayat, buat notifikasi. silent=true untuk backfill data lama.
function syncHistory(oldDb, db, silent) {
    const eventCodes = {};
    db.loans.forEach(l => { if (l.eventId && l.eventCode) eventCodes[l.eventId] = l.eventCode; });
    Object.keys(COLLECTIONS).forEach(coll => {
        const oldById = {};
        ((oldDb && oldDb[coll]) || []).forEach(r => { oldById[r.id] = r; });
        (db[coll] || []).forEach(r => {
            const before = oldById[r.id];
            const date = r.borrowDate || r.date || todayStr();
            if (!r.code) r.code = nextCode(db, COLLECTIONS[coll].prefix, yearOf(date));
            if (coll === 'loans' && r.eventId && !r.eventCode) {
                if (!eventCodes[r.eventId]) eventCodes[r.eventId] = nextCode(db, 'EVT', yearOf(date));
                r.eventCode = eventCodes[r.eventId];
            }
            if (coll === 'loans' && FINAL_STATUS.test(r.status || '') && !r.returnCode) r.returnCode = nextCode(db, 'FORM-PGB', yearOf());
            const info = describeRecord(coll, r);
            const base = Object.assign({ ref: r.code, recId: r.id, eventCode: r.eventCode || '', date: silent ? date : todayStr() }, info);
            if (!before) {
                const log = addLog(db, Object.assign(base, {
                    action: 'dibuat', user: silent ? info.who : undefined, ts: silent ? new Date(date).toISOString() : undefined
                }));
                if (!silent) notifyCreated(db, coll, r, log);
            } else if (before.status !== r.status) {
                const log = addLog(db, Object.assign(base, { action: 'status: ' + (before.status || '-') + ' → ' + r.status }));
                if (coll === 'loans') notifyLoanStatus(db, before, r, log);
            }
        });
    });
    if (silent) return;
    // Stok menipis: hanya saat baru melewati batas minimum.
    const oldItems = {};
    ((oldDb && oldDb.items) || []).forEach(i => { oldItems[i.id] = i; });
    db.items.forEach(i => {
        const before = oldItems[i.id];
        if (before && before.stock > before.minStock && i.stock <= i.minStock) {
            addNotif(db, { title: 'Stok Menipis', text: 'Stok hampir habis: ' + itemLabel(i) + ' (sisa ' + i.stock + ')', roles: ROLE_ADM, type: 'warning', key: 'low:' + i.id });
        }
    });
}
// Mengisi riwayat dari data lama (sekali saja) untuk database yang dibuat sebelum fitur riwayat ada.
function backfillHistory() {
    const db = getDB();
    if (db.activityLog.length && db.revisiMigrated) return;
    syncHistory({}, db, true);
    db.revisiMigrated = true;
    persistDB(db);
}

/* ---------- Penjaga role: dipanggil di awal fungsi approval ---------- */
// Mengembalikan true bila role user termasuk roles; jika tidak, tampilkan toast "akses ditolak".
function requireRole(roles, label) {
    if (hasRole(...roles)) return true;
    toast('Akses ditolak: hanya ' + label + ' yang berwenang.', 'danger');
    return false;
}

/* =========================================================
   NOTIFIKASI
   ========================================================= */
function addNotif(db, n) {
    if (n.key && db.notifications.some(x => x.key === n.key && Date.now() - new Date(x.ts) < 120000)) return;
    db.notifications.push(Object.assign({
        id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        ts: new Date().toISOString(), type: 'info', readBy: [], by: (currentUser() || {}).id || ''
    }, n));
}
// Notifikasi menyesuaikan role; staff hanya melihat yang menyangkut dirinya.
function notifVisible(n, u) {
    if (!u || !n.roles.includes(u.role)) return false;
    return u.role !== 'staff' || !n.names || n.names.includes(u.name);
}
function notifyCreated(db, coll, r, log) {
    const base = { ref: r.code, coll, recId: r.id, logId: log.id, eventCode: r.eventCode || '' };
    const push = n => addNotif(db, Object.assign(base, n));
    if (coll === 'loans') {
        push(r.eventName
            ? { key: 'new:' + r.eventCode, title: 'Pengajuan Event', text: 'Pengajuan peminjaman Event "' + r.eventName + '" (' + r.eventCode + ') oleh ' + r.borrower + ' menunggu persetujuan Admin.', roles: ROLE_ADM, type: 'info' }
            : { title: 'Pengajuan Peminjaman', text: r.borrower + ' mengajukan peminjaman ' + r.itemName + ' (' + r.qty + ') · ' + r.code, roles: ROLE_ADM, type: 'info' });
    }
    if (coll === 'lost') push({ title: 'Barang Hilang', text: 'Barang hilang: ' + r.itemName + ' (' + r.qty + '), pelapor ' + r.reportedBy + ' · ' + r.code, roles: ROLE_ADM, type: 'danger' });
    if (coll === 'damages') push({ title: 'Barang Rusak / MT', text: 'Barang rusak/MT: ' + r.itemName + ' (' + r.qty + ') · ' + r.code, roles: ROLE_ADM, type: 'warning' });
    if (coll === 'requests') push({ title: 'Pengajuan Pembelian', text: 'Pengajuan pembelian ' + r.itemName + ' oleh ' + r.requestedBy + ' menunggu tindak lanjut · ' + r.code, roles: ROLE_ADM, type: 'info' });
    if (coll === 'consumables') {
        const a = atkLevelOf(r);
        if (a.st === 'habis') push({ title: 'ATK Habis Terpakai', text: r.itemName + ' (' + r.qty + ') habis terpakai, dicatat ' + r.reportedBy + '. Alasan: ' + (r.reason || r.note || '-'), roles: ROLE_ADM, type: 'warning' });
        if (a.st === 'hilang') push({ title: 'ATK Hilang', text: r.itemName + ' (' + r.qty + ') dilaporkan hilang oleh ' + r.reportedBy + ' · ' + r.code, roles: ROLE_ADM, type: 'danger' });
    }
}
function notifyLoanStatus(db, before, r, log) {
    const st = r.status || '';
    const name = r.eventName ? 'Event "' + r.eventName + '"' : r.itemName;
    const id = r.eventCode || r.code;
    const names = [r.requestedBy, r.borrower, r.returnSubmittedBy].filter(Boolean);
    const base = { ref: r.code, coll: 'loans', recId: r.id, logId: log.id, eventCode: r.eventCode || '', key: 'st:' + id + ':' + st, names };
    const notify = (title, text, roles, type) => addNotif(db, Object.assign({}, base, { title, text, roles, type }));
    if (/pengembalian/.test(before.status || '') && st === 'dipinjam') notify('Pengembalian Ditolak', 'Pengajuan pengembalian ' + name + ' (' + id + ') ditolak, status kembali Sedang Dipinjam.', ROLE_ALL, 'danger');
    else if (st === 'dipinjam') notify('Peminjaman Disetujui', 'Peminjaman ' + name + ' (' + id + ') DISETUJUI Admin.', ROLE_ALL, 'success');
    else if (st === 'ditolak') notify('Peminjaman Ditolak', 'Peminjaman ' + name + ' (' + id + ') DITOLAK.', ROLE_ALL, 'danger');
    else if (st === 'menunggu_admin_pengembalian') notify('Pengajuan Pengembalian', 'Pengembalian ' + name + ' (' + id + ') menunggu pemeriksaan Admin.', ['admin'], 'info');
    else if (FINAL_STATUS.test(st)) {
        const problem = (r.issues || []).some(k => k.type !== 'habis');
        notify(problem ? 'Pengembalian Selesai (Ada Kendala)' : 'Pengembalian Selesai',
            'Barang dikembalikan: ' + name + ' (' + (r.returnCode || id) + ') · disetujui Admin',
            ROLE_ALL, problem ? 'warning' : 'success');
    }
}
// Jatuh tempo: peringatan sekali per peminjaman (<= 2 hari lagi atau sudah lewat).
function checkDue() {
    const db = getDB();
    let changed = false;
    db.loans.filter(l => l.status === 'dipinjam' && l.returnPlan && !l.dueNotified).forEach(l => {
        const days = (new Date(l.returnPlan) - new Date(todayStr())) / 864e5;
        if (days > 2) return;
        l.dueNotified = true; changed = true;
        addNotif(db, {
            title: days < 0 ? 'Terlambat' : 'Segera Jatuh Tempo',
            text: (days < 0 ? 'TERLAMBAT: ' : 'Segera jatuh tempo: ') + l.itemName + ' (' + l.code + ') - ' + fmtDate(l.returnPlan),
            roles: ROLE_ALL, names: [l.requestedBy, l.borrower].filter(Boolean), type: 'warning', ref: l.code, coll: 'loans', recId: l.id, by: ''
        });
    });
    if (changed) persistDB(db);
}
const myNotifs = () => {
    const u = currentUser();
    return u ? getDB().notifications.filter(n => notifVisible(n, u)).sort((a, b) => b.ts.localeCompare(a.ts)) : [];
};
function unreadCount() {
    const u = currentUser();
    return u ? myNotifs().filter(n => !n.readBy.includes(u.id)).length : 0;
}
function refreshBell() {
    const badge = document.getElementById('bell-badge');
    if (!badge || !currentUser()) return;
    const c = unreadCount();
    badge.textContent = c > 99 ? '99+' : c;
    badge.style.display = c ? 'flex' : 'none';
}
function markRead(ids) {
    const db = getDB(), u = currentUser();
    db.notifications.forEach(n => { if (ids.includes(n.id) && !n.readBy.includes(u.id)) n.readBy.push(u.id); });
    persistDB(db);
    refreshBell();
    renderSidebar();
}
const notifIcon = t => ({ danger: 'x-circle', warning: 'alert-triangle', success: 'check-circle' }[t] || 'info');
const notifBadgeClass = t => ({ danger: 'badge-danger', warning: 'badge-warning', success: 'badge-success' }[t] || 'badge-info');
function notifItemHtml(n, u) {
    return `<div class="np-item ${n.readBy.includes(u.id) ? '' : 'unread'} np-${n.type}" onclick="openNotif('${n.id}')">
        <b>${escapeHtml(n.title || 'Notifikasi')}</b>${n.ref ? ` <span class="badge badge-muted">${escapeHtml(n.ref)}</span>` : ''}
        <div>${escapeHtml(n.text)}</div><small>${fmtDateTime(n.ts)}</small></div>`;
}
function toggleNotifPanel() {
    const panel = document.getElementById('notif-panel');
    panel.classList.toggle('hidden');
    if (panel.classList.contains('hidden')) return;
    const u = currentUser(), list = myNotifs().slice(0, 15);
    panel.innerHTML = `<div class="np-head"><b>Notifikasi</b><button class="btn btn-secondary btn-sm" onclick="markAllNotifRead()">Tandai dibaca</button></div>`
        + (list.length ? list.map(n => notifItemHtml(n, u)).join('') : '<div class="np-empty">Belum ada notifikasi.</div>')
        + `<div class="np-foot"><a href="#" onclick="event.preventDefault();navigateTo('notifications')">Lihat semua &amp; riwayat notifikasi →</a></div>`;
}
function markAllNotifRead() {
    markRead(myNotifs().map(n => n.id));
    const panel = document.getElementById('notif-panel');
    if (!panel.classList.contains('hidden')) { toggleNotifPanel(); toggleNotifPanel(); }
    if (currentPage === 'notifications') renderPage('notifications');
}
// Detail satu notifikasi (tandai terbaca + tombol menuju detail aktivitas / riwayat event).
function openNotif(id) {
    const db = getDB(), n = db.notifications.find(x => x.id === id);
    if (!n) return;
    markRead([id]);
    document.querySelectorAll('.np-popup[data-id="' + id + '"]').forEach(e => e.remove());
    document.getElementById('notif-panel').classList.add('hidden');
    const hasLog = n.logId && db.activityLog.some(a => a.id === n.logId);
    openModal(n.title || 'Notifikasi', `<div class="detail-grid">
        <div><label>Waktu</label>${fmtDateTime(n.ts)}</div>
        <div><label>Jenis</label><span class="badge ${notifBadgeClass(n.type)}">${escapeHtml(n.type)}</span></div>
        ${n.ref ? `<div><label>ID Form</label><b>${escapeHtml(n.ref)}</b></div>` : ''}
        ${n.eventCode ? `<div><label>ID Event</label><b>${escapeHtml(n.eventCode)}</b></div>` : ''}</div>
        <p>${escapeHtml(n.text)}</p>
        <div class="rv-actions">
            ${hasLog ? `<button class="btn btn-primary" onclick="showActivity('${n.logId}')">Lihat detail aktivitas</button>` : ''}
            ${n.eventCode ? `<button class="btn btn-secondary" onclick="openEventHistory('${n.eventCode}')">Buka Riwayat Event</button>` : ''}
        </div>`);
    if (currentPage === 'notifications') {
        const area = document.getElementById('content-area'), top = area.scrollTop;
        renderPage('notifications');
        area.scrollTop = top;
    }
}
// Pop-up interaktif (seperti notifikasi aplikasi), bisa diklik untuk detail.
function showNotifPopup(n) {
    let box = document.getElementById('popup-container');
    if (!box) { box = document.createElement('div'); box.id = 'popup-container'; box.className = 'popup-container'; document.body.appendChild(box); }
    if (box.querySelector('[data-id="' + n.id + '"]')) return;
    const el = document.createElement('div');
    el.className = 'np-popup np-' + n.type;
    el.dataset.id = n.id;
    el.innerHTML = `<i data-lucide="${notifIcon(n.type)}"></i>
        <div class="np-pop-body" onclick="openNotif('${n.id}')"><b>${escapeHtml(n.title || 'Notifikasi')}</b><div>${escapeHtml(n.text)}</div><small>${fmtDateTime(n.ts)} · ketuk untuk detail</small></div>
        <button class="np-pop-x" aria-label="Tutup">×</button>`;
    el.querySelector('.np-pop-x').onclick = () => el.remove();
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    if (window.lucide) lucide.createIcons();
    setTimeout(() => el.remove(), 9000);
}
const notifSeen = new Set();
// Memunculkan pop-up untuk notifikasi baru yang belum dibaca (initial=true: saat baru login).
function pollNotifications(initial) {
    const u = currentUser();
    if (!u) return;
    const fresh = myNotifs().filter(n => !notifSeen.has(n.id));
    fresh.forEach(n => notifSeen.add(n.id));
    fresh.filter(n => !n.readBy.includes(u.id) && (initial || n.by !== u.id)).slice(0, 3).reverse().forEach(showNotifPopup);
    if (fresh.length) { refreshBell(); renderSidebar(); }
}
// Menyisipkan ikon lonceng + panel notifikasi ke topbar (sekali saja).
function injectBell() {
    if (document.getElementById('bell-btn')) return;
    const wrap = document.createElement('div');
    wrap.className = 'bell-wrap';
    wrap.innerHTML = `<button id="bell-btn" class="btn-icon" title="Notifikasi" onclick="toggleNotifPanel()"><i data-lucide="bell"></i><span id="bell-badge" class="bell-badge" style="display:none">0</span></button><div id="notif-panel" class="notif-panel hidden"></div>`;
    const right = document.querySelector('.topbar-right');
    right.insertBefore(wrap, document.getElementById('live-clock').nextSibling);
    if (window.lucide) lucide.createIcons();
}
function renderNotificationsPage() {
    const F = filterState('notif'), u = currentUser(), all = myNotifs();
    const rows = all.filter(n => dateMatches(F, n.ts) && (F.f === 'all' || !n.readBy.includes(u.id))
        && queryMatches(F.q, [n.title, n.text, n.ref, n.eventCode]));
    return `${filterBar('notif', { placeholder: 'Cari notifikasi / ID Form', years: yearOptions(all.map(n => n.ts)), extra: filterSelect('notif', 'f', [['unread', 'Belum dibaca']], 'Semua') })}
    ${rcHead(`<i data-lucide="bell"></i>Riwayat Notifikasi (${rows.length}) <small class="text-muted">· belum dibaca ${unreadCount()}</small>`,
        '<button class="btn btn-secondary btn-sm" onclick="markAllNotifRead()">Tandai semua dibaca</button>')}
    ${rcList(rows.map(n => {
        const unread = !n.readBy.includes(u.id);
        return rcCard({
            key: 'nt:' + n.id,
            cls: unread ? 'rc-unread' : '',
            chip: fmtDateTime(n.ts),
            badges: (unread ? '<span class="badge badge-info">Baru</span>' : '') + (n.ref ? `<span class="badge badge-muted">${escapeHtml(n.ref)}</span>` : ''),
            title: n.title || 'Notifikasi',
            main: `openNotif('${n.id}')`,
            extra: `<p class="rc-note">${escapeHtml(n.text)}</p>`
        });
    }), 'Tidak ada notifikasi.')}`;
}

/* =========================================================
   DETAIL AKTIVITAS & HALAMAN RIWAYAT AKTIVITAS (admin & manajemen)
   ========================================================= */
const statusBadge = text => `<span class="badge badge-${statusTone(text)}">${escapeHtml(humanizeStatus(text))}</span>`;
function showActivity(id) {
    const db = getDB(), a = db.activityLog.find(x => x.id === id);
    if (!a) return;
    const rec = (db[a.coll] || []).find(r => r.id === a.recId) || {};
    const group = a.eventCode ? db.loans.filter(l => l.eventCode === a.eventCode) : [];
    const loans = group.length ? group : (a.coll === 'loans' && rec.id ? [rec] : []);
    const photos = [rec.photo, rec.pendingPhoto, rec.invoicePhoto].filter(Boolean);
    loans.forEach(l => (l.issues || l.pendingIssues || []).forEach(k => { if (k.photo) photos.push(k.photo); }));
    const modalItems = loans.length
        ? loans.map(l => ({ name: l.itemName, qty: l.qty, sub: escapeHtml(humanizeStatus(l.status))
            + ((l.issues || []).length ? ' · Kondisi: ' + (l.issues || []).map(k => escapeHtml(kendalaLabel(k.type)) + ' ' + k.qty).join(', ') : '') }))
        : [{ name: a.items[0].name, qty: a.items[0].qty, sub: escapeHtml(humanizeStatus(rec.status || rec.level || a.status)) }];
    const history = db.activityLog.filter(x => x.ref === a.ref).sort((x, y) => x.ts.localeCompare(y.ts));
    openModal('Detail ' + a.ref, `<div class="detail-grid">
        <div><label>ID Form</label><b>${escapeHtml(a.ref)}</b>${rec.returnCode ? '<br><small>Pengembalian: ' + escapeHtml(rec.returnCode) + '</small>' : ''}</div>
        <div><label>ID Event</label>${a.eventCode ? escapeHtml(a.eventCode) : '-'}</div>
        <div><label>ID Aktivitas</label>${escapeHtml(a.id)}</div><div><label>Nama aktivitas</label>${escapeHtml(a.title)}</div>
        <div><label>Nama pengguna</label>${escapeHtml(a.who || a.user)}</div><div><label>Tanggal aktivitas</label>${fmtDateTime(a.ts)}</div>
        <div><label>Jenis</label>${escapeHtml((COLLECTIONS[a.coll] || {}).label || '-')}${a.eventCode ? ' <span class="badge badge-info">EVENT</span>' : ''}</div>
        <div><label>Status</label>${statusBadge(a.status)}</div></div>
        ${a.event ? `<p><label>Kegiatan / Event</label>${escapeHtml(a.event)}</p>` : ''}
        ${rcItemList(modalItems)}
        <p><label>Catatan</label>${escapeHtml(a.note || rec.notes || rec.note || rec.returnNotes || '-')}</p>
        ${photos.length ? `<p><label>Foto</label>${photos.slice(0, 6).map(p => thumbHtml(p)).join(' ')}</p>` : ''}
        <h4>Riwayat transaksi</h4><ul class="rv-log">${history.map(x => `<li>${fmtDateTime(x.ts)} · ${escapeHtml(x.action)} · ${escapeHtml(x.user)}</li>`).join('')}</ul>
        ${a.eventCode ? `<button class="btn btn-primary" onclick="openEventHistory('${a.eventCode}')">Buka Riwayat Event</button>` : ''}`);
}
// Thumbnail foto yang bisa diklik untuk memperbesar.
function thumbHtml(src, label) {
    return src ? `<img src="${src}" class="thumb" onclick="openAttachmentLightbox(this.src,'${label || 'Foto'}','image/jpeg')" title="Lihat foto">` : '-';
}
const HISTORY_CATEGORIES = Object.keys(COLLECTIONS).map(c => [c, COLLECTIONS[c].label])
    .concat([['loans_reg', 'Peminjaman Reguler (non-Event)'], ['loans_evt', 'Peminjaman Event']]);
function filteredActivityLog() {
    const F = filterState('history');
    return getDB().activityLog.filter(a => {
        if (F.cat === 'loans_reg' && !(a.coll === 'loans' && !a.eventCode)) return false;
        if (F.cat === 'loans_evt' && !(a.coll === 'loans' && a.eventCode)) return false;
        if (F.cat && !/^loans_/.test(F.cat) && a.coll !== F.cat) return false;
        return dateMatches(F, a.date) && queryMatches(F.q, [a.id, a.ref, a.eventCode, a.title, a.who, a.user, a.action, a.event, a.note]);
    }).sort((a, b) => b.ts.localeCompare(a.ts));
}
function renderHistoryPage() {
    const rows = filteredActivityLog(), all = getDB().activityLog;
    return `${filterBar('history', { placeholder: 'Cari ID / barang / pengguna / aktivitas', years: yearOptions(all.map(a => a.date)), extra: filterSelect('history', 'cat', HISTORY_CATEGORIES, 'Semua jenis') })}
    ${rcHead(`<i data-lucide="history"></i>Riwayat Aktivitas (${rows.length}) <small class="text-muted">· disimpan permanen, hanya Admin yang dapat menghapus</small>`, `
            <button class="btn btn-secondary btn-sm" onclick="exportActivityLog('csv')"><i data-lucide="file-spreadsheet"></i>Excel</button>
            <button class="btn btn-secondary btn-sm" onclick="exportActivityLog('pdf')"><i data-lucide="printer"></i>PDF</button>
            ${hasRole('admin') ? '<button class="btn btn-danger btn-sm" onclick="purgeActivityLog()"><i data-lucide="trash-2"></i>Hapus Riwayat Lama</button>' : ''}`)}
    ${rcList(rows.map(a => activityCard(a, true)), 'Tidak ada riwayat.')}`;
}
function purgeActivityLog() {
    if (!requireRole(['admin'], 'Admin')) return;
    const cutoff = prompt('Hapus riwayat aktivitas SEBELUM tanggal (format YYYY-MM-DD). Disarankan ekspor Excel terlebih dahulu. Data transaksi/stok tidak ikut terhapus.');
    if (!cutoff || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return;
    const db = getDB(), count = db.activityLog.filter(a => a.date < cutoff).length;
    if (!count || !confirm('Hapus ' + count + ' catatan riwayat sebelum ' + cutoff + '? Tindakan ini tidak dapat dibatalkan.')) return;
    db.activityLog = db.activityLog.filter(a => a.date >= cutoff);
    addLog(db, {
        ref: 'SISTEM', recId: '', coll: 'loans', date: todayStr(), title: 'Admin menghapus ' + count + ' riwayat sebelum ' + cutoff,
        who: currentUser().name, status: 'dihapus', action: 'purge riwayat', items: [{ name: '-', qty: 0 }]
    });
    persistDB(db);
    toast(count + ' catatan riwayat dihapus.', 'warning');
    renderPage('history');
}
function exportActivityLog(type) {
    const head = ['ID Form', 'ID Aktivitas', 'Tanggal', 'Waktu', 'Pengguna', 'Jenis', 'Barang', 'Jumlah', 'Aksi', 'Status', 'Catatan'];
    const rows = filteredActivityLog().map(a => [a.ref, a.id, a.date, fmtDateTime(a.ts), a.who || a.user, (COLLECTIONS[a.coll] || {}).label,
        (a.items[0] || {}).name, (a.items[0] || {}).qty, a.action, a.status, a.note]);
    if (type === 'csv') downloadCsv('riwayat-aktivitas.csv', [head, ...rows]);
    else printTable('Riwayat Aktivitas Gudang', head, rows);
}

/* ---------- Ekspor umum: CSV, tabel cetak, dan Excel (.xls berbasis tabel HTML) ---------- */
function downloadBlob(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadCsv(name, rows) {
    const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    downloadBlob(name, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}
// Excel dari HTML tabel (struktur gabung-sel/header tetap terjaga saat dibuka di Excel).
function downloadExcelHtml(name, bodyHtml) {
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>${bodyHtml}</body></html>`;
    downloadBlob(name, new Blob(['\ufeff' + doc], { type: 'application/vnd.ms-excel;charset=utf-8' }));
}
// Mengisi area cetak dengan HTML lalu membuka dialog print (pengguna bisa "Simpan sebagai PDF").
function printHtml(html) {
    document.getElementById('print-area').innerHTML = html;
    window.print();
}
function printTable(title, head, rows) {
    printHtml(`<h2>${escapeHtml(title)}</h2><p>Dicetak ${fmtDateTime(new Date())}</p>
        <table class="print-table"><thead><tr>${head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c == null ? '' : c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
}

/* =========================================================
   RIWAYAT EVENT (tab di halaman Pengembalian) & FORM PEMINJAMAN BARANG
   ========================================================= */
// Mengelompokkan peminjaman event (per eventCode) menjadi daftar event yang sudah diproses Admin.
function collectEvents() {
    const byCode = {};
    getDB().loans.filter(l => l.eventCode).forEach(l => {
        const e = byCode[l.eventCode] = byCode[l.eventCode] || {
            code: l.eventCode, name: l.eventName, location: l.eventLocation || '', date: l.borrowDate, returnPlan: l.returnPlan,
            requester: l.requestedBy, pj: l.borrower, adminName: l.adminApprovedBy || '', loans: []
        };
        e.loans.push(l);
    });
    return Object.values(byCode)
        .filter(e => e.loans.some(l => l.status !== 'menunggu_admin' && l.status !== 'ditolak'))
        .map(e => {
            const approved = e.loans.filter(l => l.status !== 'ditolak');
            const returned = approved.map(l => l.returnDate).filter(Boolean).sort();
            const allDone = approved.every(l => FINAL_STATUS.test(l.status));
            e.returnDate = allDone && returned.length ? returned[returned.length - 1] : e.returnPlan;
            e.items = approved;
            e.notes = [...new Set(approved.map(l => l.returnNotes || l.notes).filter(Boolean))].join(' | ');
            return e;
        })
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function filteredEvents() {
    const F = filterState('events');
    return collectEvents().filter(e => dateMatches(F, e.date)
        && queryMatches(F.q, [e.code, e.name, e.requester, e.pj, e.notes, e.items.map(l => l.code + ' ' + l.itemName).join(' ')]));
}
// Isi tab "Riwayat Event": satu kartu per event (tanggal, nama event, peminjam, PJ, daftar barang) + tombol Detail.
function renderEventHistoryTab() {
    const rows = filteredEvents(), all = collectEvents();
    return filterBar('events', { placeholder: 'Cari ID Event / nama event / peminjam / PJ / barang', years: yearOptions(all.map(e => e.date)) })
        + rcList(rows.map(e => rcCard({
            key: 'ev:' + e.code,
            chip: rcRange(e.date, e.returnDate),
            badges: `<span class="badge badge-muted">${escapeHtml(e.code)}</span>`,
            title: e.name,
            left: e.requester || '-',
            right: e.location || '-',
            extra: `<span class="text-muted">Penanggung jawab: ${escapeHtml(e.pj || '-')}</span>`,
            count: e.items.length + ' Barang',
            detail: rcItemList(e.items.map(l => ({ name: l.itemName, qty: l.qty, sub: 'ID: ' + escapeHtml(l.itemId) })))
                + rcFacts([['ID Event', e.code], ['Nama peminjam', e.requester || '-'], ['Nama PJ', e.pj || '-'], ['Catatan', e.notes || '-']]),
            actions: `<button class="btn btn-sm btn-secondary" onclick="showEvent('${e.code}')"><i data-lucide="eye"></i>Detail</button>`
        })), 'Belum ada riwayat event.');
}
// Membuka halaman Pengembalian > tab Riwayat Event, lalu menampilkan detail event tertentu.
function openEventHistory(code) {
    closeModal();
    returnTab = 'event';
    navigateTo('returns');
    showEvent(code);
}
// Data untuk form peminjaman barang milik satu event.
function eventFormModel(e) {
    return {
        eventName: e.name, eventLocation: e.location, borrowDate: e.date, returnDate: e.returnDate,
        peminjam: e.requester, items: e.items.map(l => ({ itemId: l.itemId, itemName: l.itemName, qty: l.qty }))
    };
}
// Detail event: menampilkan form peminjaman barang + tombol PDF dan Excel.
function showEvent(code) {
    const e = collectEvents().find(x => x.code === code);
    if (!e) return;
    openModal('Detail Event · ' + e.name, `
        <div class="form-doc">${buildLoanFormHtml(eventFormModel(e))}</div>
        <div class="rv-actions" style="margin-top:16px">
            <button class="btn btn-secondary" onclick="exportEventForm('pdf','${code}')"><i data-lucide="printer"></i>PDF</button>
            <button class="btn btn-secondary" onclick="exportEventForm('excel','${code}')"><i data-lucide="file-spreadsheet"></i>Excel</button>
        </div>`);
}
function exportEventForm(type, code) {
    const e = collectEvents().find(x => x.code === code);
    if (!e) return;
    const model = eventFormModel(e);
    if (type === 'pdf') printHtml(`<div class="form-doc">${buildLoanFormHtml(model)}</div>`);
    else downloadExcelHtml('form-peminjaman-' + code + '.xls', buildLoanFormHtml(model, { excel: true }));
}
const CHECKBOX = '&#9633;';
// Membangun form "Form Peminjaman Barang": judul, data event, tabel barang + checklist.
// model: { eventName, eventLocation, borrowDate, returnDate, peminjam, adminName, items:[{itemId,itemName,qty}] }
// opts: { signatures: tampilkan blok tanda tangan, excel: tambahkan border untuk Excel }
function buildLoanFormHtml(model, opts = {}) {
    const info = [
        ['Nama Event', model.eventName], ['Lokasi', model.eventLocation],
        ['Tanggal Peminjaman', model.borrowDate ? fmtDate(model.borrowDate) : ''],
        ['Tanggal Pengembalian', model.returnDate ? fmtDate(model.returnDate) : ''],
        ['Nama Peminjam', model.peminjam], ['Penyedia Barang (Admin)', model.adminName]
    ].filter(([, v]) => v);
    const border = opts.excel ? ' border="1"' : '';
    const rows = model.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${escapeHtml(it.itemId)}</td><td>${escapeHtml(it.itemName)}</td>
        <td class="c">${it.qty}</td><td class="c">${CHECKBOX}</td><td class="c">${CHECKBOX}</td><td class="c">${CHECKBOX}</td><td class="c">${CHECKBOX}</td><td></td></tr>`).join('');
    const sign = (role, name) => `<td><strong>${role}</strong><div class="sign-space"></div>(${escapeHtml(name || '...........................')})</td>`;
    return `<h2 class="form-title">FORM PEMINJAMAN BARANG</h2>
        <table class="form-info"${opts.excel ? '' : ''}>${info.map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>: ${escapeHtml(v)}</td></tr>`).join('')}</table>
        <table class="form-items"${border}>
            <thead><tr><th rowspan="2">No</th><th rowspan="2">ID Barang</th><th rowspan="2">Nama Barang</th><th rowspan="2">Jumlah</th><th colspan="4">Checklist</th><th rowspan="2">Catatan</th></tr>
            <tr><th>Admin</th><th>Ambil</th><th>Kembali</th><th>Admin</th></tr></thead>
            <tbody>${rows}</tbody></table>
        ${opts.signatures ? `<table class="form-sign"><tr>${sign('Penyedia Barang<br>(Yang Menyiapkan)', model.adminName)}${sign('User / Peminjam<br>(Penanggung Jawab)', model.peminjam)}</tr></table>` : ''}`;
}

/* =========================================================
   AUTH & INISIALISASI
   ========================================================= */
// Akun bawaan (staff/admin/manajemen) selalu bisa dipakai login di device
// manapun -- tidak tergantung isi localStorage perangkat tersebut -- supaya
// staff/admin tidak pernah terkunci hanya karena membuka aplikasi di HP/PC
// baru atau localStorage-nya berbeda dari perangkat lain.
const DEFAULT_ACCOUNTS = [
    { id: 'u-staff', username: 'staff', password: 'staff123', name: 'Budi Santoso', role: 'staff' },
    { id: 'u-admin', username: 'admin', password: 'admin123', name: 'Sari Wijaya', role: 'admin' },
    { id: 'u-mgr', username: 'manajemen', password: 'manajemen123', name: 'Hendra Kusuma', role: 'manajemen' }
];
// Memproses submit form login: mencocokkan kredensial dengan user tersimpan, dengan fallback
// ke akun bawaan (DEFAULT_ACCOUNTS) jika belum cocok, lalu masuk ke aplikasi bila berhasil.
// Titik integrasi autentikasi. Saat ini mencocokkan akun yang tersimpan di device ini.
// Untuk backend, cukup ganti isi fungsi ini dengan permintaan ke server (mis. fetch('/api/login', ...))
// yang mengembalikan data user bila berhasil, atau null bila username/password salah.
async function authenticateUser(username, password) {
    const db = getDB();
    let user = db.users.find(u => u.username === username && u.password === password);
    if (!user) {
        // Fallback: kredensial default tetap berlaku di device ini walau
        // belum pernah dibuka / datanya beda, sehingga bisa dipakai di mana saja.
        user = DEFAULT_ACCOUNTS.find(u => u.username === username && u.password === password);
    }
    return user || null;
}
// Pesan error inline pada form login (dibaca screen reader lewat role="alert").
function showLoginError(msg, invalidIds) {
    const box = document.getElementById('login-error');
    box.textContent = msg;
    box.classList.remove('hidden');
    ['login-username', 'login-password'].forEach(id =>
        document.getElementById(id).setAttribute('aria-invalid', (invalidIds || []).includes(id) ? 'true' : 'false'));
}
function clearLoginError() {
    const box = document.getElementById('login-error');
    if (box) { box.textContent = ''; box.classList.add('hidden'); }
    ['login-username', 'login-password'].forEach(id => { const el = document.getElementById(id); if (el) el.removeAttribute('aria-invalid'); });
}
// Memproses submit form login: validasi input wajib, panggil authenticateUser(), lalu masuk ke aplikasi.
async function doLogin(e) {
    e.preventDefault();
    const usernameEl = document.getElementById('login-username');
    const passwordEl = document.getElementById('login-password');
    const submitBtn = document.getElementById('login-submit');
    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    const missing = [];
    if (!username) missing.push('login-username');
    if (!password) missing.push('login-password');
    if (missing.length) {
        showLoginError(missing.length === 2 ? 'Username dan password wajib diisi.' : (missing[0] === 'login-username' ? 'Username wajib diisi.' : 'Password wajib diisi.'), missing);
        document.getElementById(missing[0]).focus();
        return;
    }
    clearLoginError();
    submitBtn.disabled = true;
    try {
        const user = await authenticateUser(username, password);
        if (!user) { showLoginError('Username atau password salah.', ['login-username', 'login-password']); passwordEl.select(); return; }
        setSession(user);
        enterApp();
    } catch (err) {
        console.error('Login gagal', err);
        showLoginError('Login gagal diproses. Periksa koneksi lalu coba lagi.');
    } finally {
        submitBtn.disabled = false;
    }
}
// Menghapus sesi login dan mengembalikan tampilan ke halaman login.
function doLogout() {
    clearSession();
    document.getElementById('app-layout').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-form').reset();
}
// Interval pengecekan jatuh tempo & notifikasi baru (ms).
const NOTIFICATION_POLL_MS = 5000;
let notificationTimer = null;
// Menampilkan layout utama aplikasi untuk pengguna yang sudah login, lalu menavigasi ke Dashboard.
function enterApp() {
    const u = currentUser();
    backfillHistory();
    injectBell();
    checkDue();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');
    document.getElementById('user-display-name').textContent = u.name;
    document.getElementById('user-display-role').textContent = u.role;
    currentPage = 'dashboard';
    refreshBell();
    notifSeen.clear();
    pollNotifications(true);
    if (!notificationTimer) {
        notificationTimer = setInterval(() => {
            if (!currentUser()) return;
            checkDue();
            pollNotifications(false);
            refreshBell();
        }, NOTIFICATION_POLL_MS);
    }
    navigateTo('dashboard');
}
// Memperbarui tampilan jam berjalan (live clock) di topbar, dipanggil tiap detik.
function updateClock() {
    const el = document.getElementById('live-clock');
    if (el) el.textContent = new Date().toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
// Menerapkan preferensi tema (gelap/terang) yang tersimpan saat halaman pertama kali dimuat.
function initTheme() {
    const saved = localStorage.getItem('gudangkita_theme');
    if (saved === 'dark') {
        document.body.classList.remove('light-mode'); document.body.classList.add('dark-mode');
        const icon = document.querySelector('#theme-toggle i, #theme-toggle svg');
        if (icon) icon.setAttribute('data-lucide', 'sun');
    }
}
// Mengganti tema antara terang dan gelap, lalu menyimpan preferensinya ke localStorage.
function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    document.body.classList.toggle('light-mode', !isDark);
    localStorage.setItem('gudangkita_theme', isDark ? 'dark' : 'light');
    const icon = document.querySelector('#theme-toggle i, #theme-toggle svg');
    if (icon) icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    if (window.lucide) lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    if (window.lucide) lucide.createIcons();

    document.getElementById('login-form').addEventListener('submit', doLogin);
    document.getElementById('login-form').addEventListener('input', clearLoginError);
    document.getElementById('login-form').addEventListener('reset', clearLoginError);
    document.getElementById('logout-btn').addEventListener('click', doLogout);
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.getElementById('mobile-toggle-open').addEventListener('click', () => document.getElementById('sidebar').classList.add('open'));
    document.getElementById('mobile-toggle-close').addEventListener('click', () => document.getElementById('sidebar').classList.remove('open'));
    // Klik pada lapisan gelap di luar sidebar (mode tablet/mobile) menutup sidebar.
    document.getElementById('sidebar').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });

    setInterval(updateClock, 1000);
    updateClock();

    // Klik di luar lonceng menutup panel notifikasi; perubahan dari tab lain memicu pembaruan notifikasi.
    document.addEventListener('click', e => {
        const panel = document.getElementById('notif-panel');
        if (panel && !e.target.closest('.bell-wrap')) panel.classList.add('hidden');
    });
    window.addEventListener('storage', e => {
        pollNotifications(false); refreshBell();
        if (e && e.key === DB_KEY && currentUser() && currentPage === 'dashboard') renderPage('dashboard');   // data berubah dari tab lain
    });

    const session = getSession();
    if (session) enterApp();
});