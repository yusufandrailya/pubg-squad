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

// 🏆 KUZENLER SQUAD - Toplam 4 Kişilik Güncel Kadro
const KUZENLER = [
    { name: 'Yusuf', pubgName: 'NEPTUNELINES', discordId: '1348465377755267164' },
    { name: 'Mustafa', pubgName: 'M500CK', discordId: '1000041385652654201' },
    { name: 'Barat', pubgName: 'yt-TekneciBarat', discordId: '935270508985983056' },
    { name: 'Borax', pubgName: 'etli_KREP', discordId: '991049606722912327' }
];

// Aynı maçı tekrar raporlamamak için hafıza
let sonKontrolEdilenMaclar = new Set();

client.once('ready', () => {
    console.log(`${client.user.tag} aktif! 4 kişilik kadroyla akıllı PUBG takibi başladı.`);
    
    // Her 5 dakikada bir maçları kontrol et
    setInterval(maclariKontrolEt, 5 * 60 * 1000);
});

async function maclariKontrolEt() {
    try {
        const headers = {
            'Authorization': `Bearer ${process.env.PUBG_TOKEN}`,
            'Accept': 'application/vnd.api+json'
        };

        // Her kuzenin son maçına bakıyoruz ki kim kiminle girdiyse kaçmasın!
        for (const aktifKuzen of KUZENLER) {
            const url = `https://api.pubg.com/shards/steam/players?filter[playerNames]=${aktifKuzen.pubgName}`;
            const response = await axios.get(url, { headers });
            
            if (!response.data.data || response.data.data.length === 0) continue;
            
            const playerMatches = response.data.data[0].relationships.matches.data;
            if (playerMatches.length === 0) continue;
            
            const sonMacId = playerMatches[0].id;

            // Eğer bu maç zaten incelendiyse sonraki kuzene geç
            if (sonKontrolEdilenMaclar.has(sonMacId)) continue;

            // Maçın detaylarını PUBG sunucusundan çek
            const matchUrl = `https://api.pubg.com/shards/steam/matches/${sonMacId}`;
            const matchResponse = await axios.get(matchUrl, { headers });
            
            const participants = matchResponse.data.included.filter(x => x.type === 'participant');
            
            let macOzeti = [];
            let ilkKanFeda = { name: 'Bilinmiyor', time: 999999 };
            let mactakiKuzenSayisi = 0;

            // Maçta kaç kuzen var, önce onu tespit ediyoruz
            for (const kuzen of KUZENLER) {
                const veri = participants.find(p => p.attributes.stats.name.toLowerCase() === kuzen.pubgName.toLowerCase());
                
                if (veri) {
                    mactakiKuzenSayisi++;
                    const stats = veri.attributes.stats;
                    
                    macOzeti.push({
                        discordTag: `<@${kuzen.discordId}>`,
                        kills: stats.kills,
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

            // Eğer maçta en az 2 kuzen VARSA raporla, solo ise es geç!
            if (mactakiKuzenSayisi >= 2) {
                sonKontrolEdilenMaclar.add(sonMacId);
                await disordaRaporLa(macOzeti, ilkKanFeda);
                break; 
            } else if (mactakiKuzenSayisi == 1) {
                // Eleman tek başına girmiş, maçı hafızaya alalım
                sonKontrolEdilenMaclar.add(sonMacId);
            }
        }

    } catch (error) {
        console.error("PUBG API sorgulanırken pürüz çıktı:", error.message);
    }
}

async function disordaRaporLa(ozetler, ilkKan) {
    const kanal = client.channels.cache.get(DISCORD_KANAL_ID);
    if (!kanal) return;

    // En çok kill alanı TOP 1 yapıyoruz
    ozetler.sort((a, b) => b.kills - a.kills);
    const macinAgasi = ozetler[0];

    const embed = new EmbedBuilder()
        .setTitle('🍗 KUZENLER SQUAD - MAÇ SONU RAPORU')
        .setDescription('Ekip tam kadro mermileri konuşturmuş, dedektör raporu hazırladı abi!')
        .setColor('#ffaa00')
        .setTimestamp();

    embed.addFields({ 
        name: '👑 MAÇIN AĞASI (TOP 1)', 
        value: `${macinAgasi.discordTag} -> **${macinAgasi.kills} Kill** (${macinAgasi.headshots} Headshot) | **Damage:** ${macinAgasi.damage}` 
    });

    let detayMetni = '';
    ozetler.forEach((k, index) => {
        if(index === 0 && ozetler.length > 1) return;
        detayMetni += `${k.discordTag} -> **${k.kills} Kill** | **Damage:** ${k.damage}\n`;
    });
    
    if (detayMetni) {
        embed.addFields({ name: '🥈 DİĞER YANCILAR', value: detayMetni });
    }

    let ifsaMetni = '';
    
    const tofasci = ozetler.find(x => x.roadKills > 0);
    if (tofasci) ifsaMetni += `🏎️ **Mad Max:** ${tofasci.discordTag} arabayla ${tofasci.roadKills} kişiyi ezdi!\n`;

    const eczaci = ozetler.sort((a,b) => b.heals - a.heals)[0];
    if (eczaci && eczaci.heals > 5) ifsaMetni += `💉 **Eczane Sahibi:** ${eczaci.discordTag} can havliyle ${eczaci.heals} kere kit/boost bastı!\n`;

    const kurtarici = ozetler.find(x => x.revives > 0);
    if (kurtarici) ifsaMetni += `🤝 **Hızır Acil:** ${kurtarici.discordTag} yerde sürünen kuzenini ${kurtarici.revives} kere kaldırdı!\n`;

    if (ilkKan.name !== 'Bilinmiyor') {
        ifsaMetni += `💀 **İlk Kan:** ${ilkKan.name} silah bulamadan erkenden lobiye döndü.\n`;
    }

    if (ifsaMetni) {
        embed.addFields({ name: '🚨 KUZENLER OTO GALERİA / İFŞA', value: ifsaMetni });
    }

    await kanal.send({ embeds: [embed] });
}

// Çökme Önleyici Zırh
process.on('unhandledRejection', (reason, p) => { console.log('Çökme engellendi:', reason); });
process.on('uncaughtException', (err, origin) => { console.log('Çökme engellendi:', err); });

client.login(process.env.TOKEN);