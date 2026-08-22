/* =========================================================================
 * KONFIGURASI BACKEND — KKGO CUP / BADMINTIME
 * =========================================================================
 * File ini isinya cuma SATU baris penting: URL Web App Google Apps Script
 * (Code.gs) yang sudah di-deploy. Karena file ini dimuat oleh index.html
 * SEBELUM app.js, URL ini otomatis dipakai oleh SEMUA orang yang membuka
 * link GitHub Pages ini — tanpa perlu isi apa pun lagi di menu Pengaturan.
 *
 * Ini yang membuat aplikasi berperilaku seperti "1 link Google Sheet buat
 * semua orang": begitu link dibuka di HP/laptop siapa pun, aplikasi
 * langsung tersambung ke database yang sama dan menarik data terbaru.
 *
 * CARA ISI:
 *  1. Selesaikan dulu langkah "Pasang Backend" di README.md (buat
 *     spreadsheet, tempel Code.gs, Deploy > Web app), sampai dapat URL
 *     yang diakhiri "/exec".
 *  2. Tempel URL itu menggantikan teks placeholder di bawah, di antara
 *     tanda kutip.
 *  3. Commit / upload ulang file ini (config.js) bersama index.html,
 *     style.css, app.js ke GitHub Pages.
 *
 * CATATAN:
 *  - Kalau URL di bawah masih placeholder (belum diganti), aplikasi tetap
 *    bisa dipakai, tapi HANYA tersimpan di perangkat masing-masing
 *    (localStorage) — persis masalah "data hilang / balik ke awal" yang
 *    ingin diperbaiki. Wajib diisi supaya data tersinkron otomatis.
 *  - Kalau nanti backend di-deploy ulang dan URL /exec berubah, cukup
 *    update baris ini lalu upload ulang — tidak perlu ubah file lain.
 * ========================================================================= */
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyfkFlv1NLXIDIAFQ4wnz2GobcmMeg26-V3byOLud5p0-Mkm8egpqOGF257EUa2hReD/exec";
