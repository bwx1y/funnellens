export const campaigns = [
  {id:"grosir", name:"Prospek Grosir Nasional", channel:"wa", placement:"Instagram Reels", color:"mint", weekly:[3510000,92300,1800,368,91,28,9]},
  {id:"toko", name:"Paket Reseller Sekolah", channel:"wa", placement:"Instagram Feed", color:"blue", weekly:[2400000,64200,1500,244,55,16,4]},
  {id:"web", name:"Katalog Kaos Kaki", channel:"web", placement:"Instagram Feed", color:"violet", weekly:[2510000,71900,1620,1188,432,181,72]},
];

export const stageNames = {
  wa:["Tayangan","Klik link","Percakapan dimulai","Warm pertama","Hot pertama","Indikasi closing"],
  web:["Tayangan","Klik link","Landing page view","ViewContent","AddToCart","Purchase"],
};

export const dimensions = [
  {name:"Efisiensi biaya", sample:"hasil", min:15, mature:50},
  {name:"Daya tarik perhatian", sample:"tayangan", min:3000, mature:5000},
  {name:"Kualitas hasil", sample:"lead matang", min:10, mature:20},
  {name:"Kesehatan & umur", sample:"hari setelah matang", min:7, mature:14},
];

export const creatives = [
  {id:"CL-101", name:"Dari Pabrik ke Tokomu", campaign:"grosir", format:"Video", hook:"Bukti produksi", impressions:17400, results:92, leads:66, hot:24, spend:624000, days:24, p:[91,84,75,71], message:[6,7,42,58], allocation:[22,37], fatigue:[2.4,2.3,1.8,2.2,6700,6783,0], color:"mint"},
  {id:"CL-102", name:"Harga Grosir 500 Lusin", campaign:"grosir", format:"Gambar", hook:"Harga di awal", impressions:16300, results:64, leads:56, hot:17, spend:620800, days:21, p:[74,77,71,61], message:[7,7,42,56], allocation:[19,26], fatigue:[2.2,2.1,1.7,1.9,9600,9700,0], color:"blue"},
  {id:"CL-103", name:"Stok Siap Kirim", campaign:"grosir", format:"Video", hook:"Ketersediaan stok", impressions:12300, results:54, leads:44, hot:8, spend:847800, days:20, p:[24,48,27,21], message:[5,7,23,44], allocation:[18,10], fatigue:[2.7,1.9,2.2,3.1,10600,15700,4], engagement:[1.2,.84], color:"peach"},
  {id:"CL-104", name:"Cerita Mitra Grosir", campaign:"grosir", format:"Carousel", hook:"Testimoni", impressions:6100, results:37, leads:25, hot:5, spend:369000, days:11, p:[54,56,53,53], message:[5,7,17,25], allocation:[9,12], fatigue:[2.2,1.8,1.8,2.4,8400,9973,0], color:"violet"},
  {id:"CL-105", name:"Pilihan Warna & Ukuran", campaign:"grosir", format:"Gambar", hook:"Pilihan produk", impressions:7600, results:52, leads:26, hot:8, spend:615000, days:16, p:[48,57,68,58], message:[5,7,16,26], allocation:[14,10], fatigue:[1.9,1.9,1.3,1.4,11700,11827,0], color:"sky"},
  {id:"CL-106", name:"Detail Bahan dari Dekat", campaign:"grosir", format:"Video", hook:"Bukti produksi", impressions:5240, results:22, leads:19, hot:4, spend:240000, days:8, p:[60,79,50,65], message:[5,7,11,19], allocation:[9,5], fatigue:[2.4,2.6,1.2,1.4,11000,10909,0], color:"mint"},
  {id:"CL-107", name:"Pabrik & Gudang", campaign:"grosir", format:"Video", hook:"Bukti produksi", impressions:6300, results:30, leads:24, hot:6, spend:262000, days:13, p:[65,66,61,59], message:[6,7,16,24], allocation:[9,11], fatigue:[2.3,2.3,1.5,1.6,8700,8733,0], color:"sky"},
  {id:"CL-108", name:"Paket Stok Bulanan", campaign:"grosir", format:"Gambar", hook:"Harga di awal", impressions:6900, results:31, leads:24, hot:4, spend:425000, days:13, p:[44,53,37,54], message:[5,7,13,24], allocation:[12,8], fatigue:[1.8,1.8,1.6,1.6,13500,13710,0], color:"blue"},
  {id:"CL-109", name:"Paket Tahun Ajaran", campaign:"toko", format:"Gambar", hook:"Harga di awal", impressions:13800, results:78, leads:43, hot:6, spend:811200, days:17, p:[58,78,54,54], message:[6,7,29,43], allocation:[25,29], fatigue:[2.1,2.0,1.4,1.6,10100,10400,0], color:"blue"},
  {id:"CL-110", name:"Tampilan Katalog Baru", campaign:"web", format:"Video", hook:"Pilihan produk", impressions:24900, results:72, leads:0, hot:0, spend:1022400, days:19, p:[75,85,65,58], message:[6,7,0,0], allocation:[34,46], fatigue:[2.4,2.3,1.7,2.2,13900,14200,0], color:"violet"},
  {id:"CL-111", name:"Motif Sekolah Harian", campaign:"toko", format:"Gambar", hook:"Pilihan produk", impressions:1240, results:8, leads:5, hot:1, spend:82000, days:4, p:[50,50,50,50], message:[4,7,2,5], allocation:[5,3], fatigue:[1.4,1.3,1.2,1.2,9200,10250,0], color:"peach", controlled:true},
];

export const leads = [
  {id:"WA-4821", alias:"Mitra 4821", level:"Hot", prior:"Warm", confidence:"Tinggi", status:"Final", campaign:"grosir", creative:"CL-101", date:"2026-11-18", topic:"Pembayaran", type:"Komitmen", mood:"Positif", minutes:12, quote:"Kalau 500 lusin siap dikirim, saya ambil. Bisa kirim invoice?", before:"Stok 500 lusin tersedia. Mau kami buatkan invoice?", why:"Lead menyebut jumlah pesanan dan meminta invoice.", initials:"M", color:"mint"},
  {id:"WA-3174", alias:"Mitra 3174", level:"Warm", prior:"Cold", confidence:"Sedang", status:"Final", campaign:"grosir", creative:"CL-102", date:"2026-11-17", topic:"Stok dan ukuran", type:"Tanya lanjut", mood:"Netral", minutes:27, quote:"Yang ukuran SD ada warna putih polos? Ada katalog?", before:"Untuk eceran atau stok toko, Kak?", why:"Lead meminta variasi produk yang sesuai dengan kebutuhan tokonya.", initials:"M", color:"blue"},
  {id:"WA-9062", alias:"Mitra 9062", level:"Cold", prior:"Cold", confidence:"Rendah", status:"Awal", campaign:"toko", creative:"CL-109", date:"2026-11-19", topic:"Perkenalan", type:"Pengakuan netral", mood:"Netral", minutes:null, quote:"Halo, boleh minta info?", before:null, why:"Percakapan baru dimulai. Semua lead mulai dari Cold.", initials:"M", color:"violet"},
  {id:"WA-6418", alias:"Mitra 6418", level:"Warm", prior:"Hot", confidence:"Sedang", status:"Final", campaign:"grosir", creative:"CL-103", date:"2026-11-15", topic:"Pengiriman", type:"Keberatan", mood:"Negatif", minutes:65, quote:"Ongkirnya cukup tinggi. Kalau diambil sendiri bisa?", before:"Kami sudah hitung ongkir ke [lokasi]. Mau lanjut?", why:"Lead belum menyetujui biaya kirim dan masih meminta alternatif.", initials:"M", color:"peach"},
  {id:"WA-7265", alias:"Mitra 7265", level:"Cold", prior:"Warm", confidence:"Tinggi", status:"Final", campaign:"toko", creative:"CL-109", date:"2026-11-14", topic:"Ketersediaan", type:"Menolak", mood:"Negatif", minutes:112, quote:"Terima kasih, kami sudah pesan dari pemasok lain.", before:"Paket sekolah bisa kami siapkan. Mau dikirim kapan?", why:"Lead menyatakan sudah membeli dari pemasok lain.", initials:"M", color:"violet"},
  {id:"WA-1538", alias:"Mitra 1538", level:"Warm", prior:"Warm", confidence:"Sedang", status:"Final", campaign:"grosir", creative:"CL-105", date:"2026-11-13", topic:"Waktu pembelian", type:"Menunda", mood:"Netral", minutes:24, quote:"Saya cek dengan tim minggu ini, nanti saya kabari.", before:"Apakah ukuran ini sesuai untuk toko Anda?", why:"Lead akan berkonsultasi dengan tim sebelum melanjutkan.", initials:"M", color:"blue"},
  {id:"WA-4816", alias:"Mitra 4816", level:"Cold", prior:"Cold", confidence:"Tinggi", status:"Final", campaign:"toko", creative:"CL-111", date:"2026-11-16", topic:"Di luar topik", type:"Di luar topik", mood:"Netral", minutes:14, quote:"Maaf, salah nomor.", before:"Halo, ada yang bisa kami bantu?", why:"Balasan menunjukkan pesan salah tujuan.", initials:"M", color:"violet"},
  {id:"WA-2730", alias:"Mitra 2730", level:"Hot", prior:"Warm", confidence:"Tinggi", status:"Final", campaign:"grosir", creative:"CL-107", date:"2026-11-10", topic:"Pembayaran", type:"Komitmen", mood:"Positif", minutes:9, quote:"Saya ambil paket grosir. Bisa kirim nomor rekening?", before:"Mau lanjut dengan paket grosir yang tadi?", why:"Lead mengonfirmasi paket dan meminta detail pembayaran.", initials:"M", color:"mint"},
];

export const responseTypes = ["Komitmen","Tanya lanjut","Keberatan","Menunda","Menolak","Pengakuan netral","Di luar topik"];
export const periods = [{id:7,label:"13–19 Nov 2026"},{id:14,label:"6–19 Nov 2026"},{id:30,label:"21 Okt–19 Nov 2026"}];

export const dailyShares = [0.12,0.15,0.13,0.16,0.12,0.17,0.15];
export const dailyRows = Object.fromEntries(campaigns.map(campaign=>{
  const rows=[];
  for (let week=0;week<9;week++) {
    const baseline=[.90,.95,.91,campaign.channel==="wa"?1.37:.96,1.13,1.07,1.04];
    const trend=[0,.02,-.015,.06,-.025,.025,.055,.01,.04][week];
    const totals=campaign.weekly.map((value,i)=>Math.round(value*(week===0?1:baseline[i]+trend)));
    let used=0;
    dailyShares.forEach((share,index)=>{
      const next=used+share;
      rows.push(totals.map(value=>Math.round(value*next)-Math.round(value*used)));
      used=next;
    });
  }
  return [campaign.id,rows];
}));

