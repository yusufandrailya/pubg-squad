const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

// Express Ayarı (Railway'in botu açık tutması için)
const app = express();
app.get('/', (req, res) => res.send('PUBG Dedektörü Aktif!'));
app.listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- AYARLAR ---
const DISCORD_KANAL_ID = '1506337976219602954'; // Maç özetlerinin düşeceği kanal ID'si

// :trophy: KUZENLER SQUAD - Toplam 4 Kişilik Güncel Kadro
const KUZENLER = [
    { name: 'Yusuf', pubgName: 'NEPTUNELINES', discordId: '1348465377755267164' },
    { name: 'Mustafa', pubgName: 'M500CK', discordId: '1000041385652654201' },
    { name: 'Barat', pubgName: 'yt-TekneciBarat', discordId: '935270508985983056' },
    { name: 'Borax', pubgName: 'etli_KREP', discordId: '991049606722912327' }
];

// Aynı maçı tekrar raporlamamak için hafıza
let sonKontrolEdilenMaclar = new Set();

// 📊 HAFTALIK LİG TABLOSU HAFIZASI (Wins eklendi abi)
let haftalikVeriler = {};
KUZENLER.forEach(k => {
    haftalikVeriler[k.discordId] = { name: k.name, kills: 0, assists: 0, wins: 0, roadKills: 0, revives: 0, heals: 0, macSayisi: 0 };
});

client.once('ready', () => {
    console.log(`${client.user.tag} aktif! Birincilik sayacı ve haftalık lig devrede.`);
    
    // Her 5 dakikada bir maçları kontrol et
    setInterval(maclariKontrolEt, 5 * 60 * 1000);

    // Her saat başı kontrol et, eğer Pazar gecesi 00:00 ise haftalık raporu patlat
    setInterval(haftalikRaporKontrol, 60 * 60 * 1000);
});

async function maclariKontrolEt() {
    try {
        const headers = {
            'Authorization': `Bearer ${process.env.PUBG_TOKEN}`,
            'Accept': 'application/vnd.api+json'
        };

        for (const aktifKuzen of KUZENLER) {
            const url = `https://api.pubg.com/shards/steam/players?filter[playerNames]=${aktifKuzen.pubgName}`;
            const response = await axios.get(url, { headers });
            
            if (!response.data.data || response.data.data.length === 0) continue;
            
            const playerMatches = response.data.data[0].relationships.matches.data;
            if (playerMatches.length === 0) continue;
            
            const sonMacId = playerMatches[0].id;
            if (sonKontrolEdilenMaclar.has(sonMacId)) continue;

            const matchUrl = `https://api.pubg.com/shards/steam/matches/${sonMacId}`;
            const matchResponse = await axios.get(matchUrl, { headers });
            
            const participants = matchResponse.data.included.filter(x => x.type === 'participant');
            
            let macOzeti = [];
            let ilkKanFeda = { name: 'Bilinmiyor', time: 999999 };
            let mactakiKuzenSayisi = 0;

            for (const kuzen of KUZENLER) {
                const veri = participants.find(p => p.attributes.stats.name.toLowerCase() === kuzen.pubgName.toLowerCase());
                
                if (veri) {
                    mactakiKuzenSayisi++;
                    const stats = veri.attributes.stats;
                    
                    macOzeti.push({
                        discordId: kuzen.discordId,
                        discordTag: `<@${kuzen.discordId}>`,
                        kills: stats.kills,
                        assists: stats.assists,
                        headshots: stats.headshotKills,
                        damage: Math.round(stats.damageDealt),
                        revives: stats.revives,
                        heals: stats.heals + stats.boosts,
                        roadKills: stats.roadKills,
                        timeSurvived: stats.timeSurvived
                    });

                    if (stats.timeSurvived < ilkKanFeda.time && stats.kills === 0) {
                        ilkKanFeda = { name: `<@${kuzen.discordId}>`, time: stats.timeSurvived };
                    }
                }
            }

            // Eğer maçta en az 2 kuzen varsa raporla ve HAFTALIK HAFIZAYA EKLE
            if (mactakiKuzenSayisi >= 2) {
                sonKontrolEdilenMaclar.add(sonMacId);
                
                // 🍗 Maçın genel sıralamasını (WinPlace) PUBG verisinden kontrol ediyoruz abi
                let winDurumu = false;
                try {
                    const ilkKuzenPubgName = KUZENLER.find(k => k.discordId === macOzeti[0].discordId)?.pubgName.toLowerCase();
                    const rosterList = matchResponse.data.included.filter(x => x.type === 'roster');
                    const bizimTakim = rosterList.find(r => 
                        r.relationships.participants.data.some(p => {
                            const participantData = matchResponse.data.included.find(i => i.id === p.id);
                            return participantData?.attributes.stats.name.toLowerCase() === ilkKuzenPubgName;
                        })
                    );
                    if (bizimTakim && bizimTakim.attributes.stats.rank === 1) {
                        winDurumu = true;
                    }
                } catch (e) {
                    console.log("Sıralama kontrolünde ufak pürüz.");
                }

                // Haftalık istatistikleri dolduruyoruz abi
                macOzeti.forEach(k => {
                    if (haftalikVeriler[k.discordId]) {
                        haftalikVeriler[k.discordId].kills += k.kills;
                        haftalikVeriler[k.discordId].assists += k.assists;
                        haftalikVeriler[k.discordId].roadKills += k.roadKills;
                        haftalikVeriler[k.discordId].revives += k.revives;
                        haftalikVeriler[k.discordId].heals += k.heals;
                        haftalikVeriler[k.discordId].macSayisi += 1;
                        if (winDurumu) {
                            haftalikVeriler[k.discordId].wins += 1; // Şampiyon olunduysa haftalık galibiyete ekle abi!
                        }
                    }
                });

                await disordaRaporLa(macOzeti, ilkKan, winDurumu);
                break; 
            } else if (mactakiKuzenSayisi == 1) {
                sonKontrolEdilenMaclar.add(sonMacId);
            }
        }

    } catch (error) {
        console.error("PUBG API sorgulanırken pürüz çıktı:", error.message);
    }
}

async function disordaRaporLa(ozetler, ilkKan, winDurumu) {
    const kanal = client.channels.cache.get(DISCORD_KANAL_ID);
    if (!kanal) return;

    ozetler.sort((a, b) => b.kills - a.kills);
    const macinAgasi = ozetler[0];

    const embed = new EmbedBuilder()
        .setTimestamp();

    // 🏆 Eğer 1. olduysanız yeşil alevli şampiyonluk teması, normal maçsa turuncu
    if (winDurumu) {
        embed.setTitle('🍗 WINNER WINNER CHICKEN DINNER! 🏆')
             .setDescription('**KUZENLER LİGİNDE BÜYÜK ŞENLİK! Ekip çorba parasını çıkardı, maçı 1. BİTİRDİ!** 🥳🔥')
             .setColor('#00ff44');
    } else {
        embed.setTitle('🍗 KUZENLER SQUAD - MAÇ SONU RAPORU')
             .setDescription('Ekip yine beraber mermileri konuşturmuş, dedektör raporu hazırladı abi!')
             .setColor('#ffaa00');
    }

    embed.addFields({ 
        name: '👑 MAÇIN AĞASI (TOP 1)', 
        value: `${macinAgasi.discordTag} -> **${macinAgasi.kills} Kill** (${macinAgasi.assists} Asist) | **Damage:** ${macinAgasi.damage}` 
    });

    let detayMetni = '';
    ozetler.forEach((k, index) => {
        if(index === 0 && ozetler.length > 1) return;
        detayMetni += `${k.discordTag} -> **${k.kills} Kill** (${k.assists} Asist) | **Damage:** ${k.damage}\n`;
    });
    
    if (detayMetni) {
        embed.addFields({ name: '🥈 DİĞER YANCILAR', value: detayMetni });
    }

    let ifsaMetni = '';
    
    const asistan = ozetler.sort((a,b) => b.assists - a.assists)[0];
    if (asistan && asistan.assists > 0) ifsaMetni += `🤝 **Hakkı Yenen Emekçi:** ${asistan.discordTag} bu maç tam ${asistan.assists} asist yaparak takımın gizli kahramanı oldu!\n`;

    const tofasci = ozetler.find(x => x.roadKills > 0);
    if (tofasci) ifsaMetni += `🏎️ **Mad Max:** ${tofasci.discordTag} arabayla ${tofasci.roadKills} kişiyi ezdi!\n`;

    const eczaci = ozetler.sort((a,b) => b.heals - a.heals)[0];
    if (eczaci && eczaci.heals > 5) ifsaMetni += `💉 **Eczane Sahibi:** ${eczaci.discordTag} can havliyle ${eczaci.heals} kere kit/boost bastı!\n`;

    const kurtarici = ozetler.find(x => x.revives > 0);
    if (kurtarici) ifsaMetni += `🏥 **Hızır Acil:** ${kurtarici.discordTag} yerde sürünen kuzenini ${kurtarici.revives} kere kaldırdı!\n`;

    if (ilkKan.name !== 'Bilinmiyor' && !winDurumu) {
        ifsaMetni += `💀 **İlk Kan:** ${ilkKan.name} silah bulamadan erkenden lobiye döndü.\n`;
    }

    if (ifsaMetni) {
        embed.addFields({ name: '🚨 KUZENLER OTO GALERİA / İFŞA', value: ifsaMetni });
    }

    await kanal.send({ embeds: [embed] });
}

// 📅 PAZAR GECESİ BÜYÜK RAPOR FONKSİYONU
async function haftalikRaporKontrol() {
    const simdi = new Date();
    if (simdi.getDay() === 0 && simdi.getHours() === 0) {
        const kanal = client.channels.cache.get(DISCORD_KANAL_ID);
        if (!kanal) return;

        let siraliLig = Object.keys(haftalikVeriler).map(id => ({
            id: id,
            ...haftalikVeriler[id]
        })).sort((a, b) => b.kills - a.kills);

        const haftaninAgasi = siraliLig[0];

        const embed = new EmbedBuilder()
            .setTitle('🏆 KUZENLER LİGİ HAFTALIK BÜYÜK RAPORU')
            .setDescription('Hafta boyunca oynanan tüm ortak maçlar toplandı ve bilançolar hazırlandı abi!')
            .setColor('#00ff44')
            .setTimestamp();

        if (haftaninAgasi && haftaninAgasi.kills > 0) {
            embed.addFields({
                name: '🥇 HAFTANIN TOP 1 ŞAMPİYONU',
                value: `👑 <@${haftaninAgasi.id}> haftayı tam **${haftaninAgasi.kills} Kill** ile kapatarak ligin ağası oldu! Helal olsun!`
            });
        }

        // 📊 Genel lig tablosunda artık kazanılan birincilik (WINS) sayısı da yazıyor abi!
        let siralamaMetni = '';
        siraliLig.forEach((k, index) => {
            siralamaMetni += `**${index + 1}.** <@${k.id}> -> **${k.kills} Kill** (${k.assists} Asist) | 🏆 **${k.wins} Çorba (Galibiyet)** | ${k.macSayisi} Maç\n`;
        });
        embed.addFields({ name: '📊 HAFTALIK GENEL SKOR TABLOSU', value: siralamaMetni });

        let haftalikIfsa = '';
        
        const haftalikAsistKrali = siraliLig.sort((a,b) => b.assists - a.assists)[0];
        if (haftalikAsistKrali && haftalikAsistKrali.assists > 0) haftalikIfsa += `🤝 **Haftanın Yancısı / Asist Kralı:** <@${haftalikAsistKrali.id}> (Hafta boyunca tam ${haftalikAsistKrali.assists} kill çaldırdı!)\n`;

        const enCokEzen = siraliLig.sort((a,b) => b.roadKills - a.roadKills)[0];
        if (enCokEzen && enCokEzen.roadKills > 0) haftalikIfsa += `🏎️ **Haftanın Ehliyetsiz Sürücüsü:** <@${enCokEzen.id}> (Arabayla ${enCokEzen.roadKills} leş!)\n`;

        const enCokKaldiran = siraliLig.sort((a,b) => b.revives - a.revives)[0];
        if (enCokKaldiran && enCokKaldiran.revives > 0) haftalikIfsa += `🏥 **Haftanın Hızır Acili:** <@${enCokKaldiran.id}> (Tam ${enCokKaldiran.revives} kere kuzenlerini kaldırdı!)\n`;

        if (haftalikIfsa) {
            embed.addFields({ name: '🚨 HAFTANIN DİĞER REKORLARI', value: haftalikIfsa });
        }

        await kanal.send({ embeds: [embed] });

        // Verileri yeni hafta için sıfırla
        KUZENLER.forEach(k => {
            haftalikVeriler[k.discordId] = { name: k.name, kills: 0, assists: 0, wins: 0, roadKills: 0, revives: 0, heals: 0, macSayisi: 0 };
        });
    }
}

// Çökme Önleyici Zırh
process.on('unhandledRejection', (reason, p) => { console.log('Çökme engellendi:', reason); });
process.on('uncaughtException', (err, origin) => { console.log('Çökme engellendi:', err); });

client.login(process.env.TOKEN);
