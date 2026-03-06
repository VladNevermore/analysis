// ==UserScript==
// @name         Анализ клиента
// @namespace    http://tampermonkey.net/
// @version      4.4
// @description  Анализ
// @match        https://crm.finleo.ru/crm/orders/*
// @author       VladNevermore
// @icon         https://i.pinimg.com/736x/78/53/ad/7853ade6dd49b8caba4d1037e7341323.jpg
// @connect      companium.ru
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/VladNevermore/analysis/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/VladNevermore/analysis/main/script.user.js
// ==/UserScript==

(function() {
    'use strict';

    function fetchUrl(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
                onload: function(response) {
                    if (response.status === 200) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`Сайт вернул код ${response.status}`));
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    const interval = setInterval(() => {
        const spans = document.querySelectorAll('span');
        let innElement = null;
        let innText = '';

        for (let span of spans) {
            if (span.textContent.includes('ИНН ')) {
                innElement = span;
                innText = span.textContent.replace(/\D/g, '');
                break;
            }
        }

        if (innElement && !document.getElementById('tm-check-companium-btn') && innText.length >= 10) {
            createCheckButton(innElement, innText);
            clearInterval(interval);
        }
    }, 1500);

    function createCheckButton(element, inn) {
        const btn = document.createElement('button');
        btn.id = 'tm-check-companium-btn';
        btn.textContent = 'Анализ';
        btn.style.cssText = `
            margin-left: 12px;
            padding: 4px 10px;
            background: #1976d2;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: 0.2s;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;

        btn.onmouseover = () => { if (!btn.disabled) btn.style.background = '#1565c0'; };
        btn.onmouseout = () => { if (!btn.disabled) btn.style.background = '#1976d2'; };

        btn.onclick = async (e) => {
            e.preventDefault();
            btn.textContent = '⏳ Загрузка...';
            btn.disabled = true;
            btn.style.background = '#9e9e9e';

            try {
                const data = await parseCompaniumFullAsync(inn);
                showWidget(data, inn);
                btn.textContent = 'Анализ обновлен';
                btn.style.background = '#2e7d32';
            } catch (error) {
                btn.textContent = '❌ Ошибка';
                btn.style.background = '#d32f2f';
                console.error("Ошибка парсинга Companium:", error);
                alert("Не удалось загрузить данные: " + error.message);
            } finally {
                btn.disabled = false;
            }
        };

        element.parentNode.style.display = 'flex';
        element.parentNode.style.alignItems = 'center';
        element.parentNode.appendChild(btn);
    }

    function formatMoneyVal(num) {
        if (num === 0) return '0 руб.';
        if (num >= 1e9) return (num / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' млрд руб.';
        if (num >= 1e6) return (num / 1e6).toFixed(2).replace(/\.?0+$/, '') + ' млн руб.';
        if (num >= 1e3) return (num / 1e3).toFixed(2).replace(/\.?0+$/, '') + ' тыс. руб.';
        return num.toLocaleString('ru-RU') + ' руб.';
    }

    async function parseCompaniumFullAsync(inn) {
        const mainUrl = `https://companium.ru/search?query=${inn}`;
        const mainHtml = await fetchUrl(mainUrl);

        const extract = (regex, group = 1, defaultVal = 'Нет данных') => {
            const match = mainHtml.match(regex);
            return match ? match[group].replace(/&quot;/g, '"').trim() : defaultVal;
        };

        const isIP = mainHtml.includes('ОГРНИП');
        const name = extract(/<h1[^>]*>([^<]+)<\/h1>/i, 1, 'Не найдено');
        const ogrn = extract(/>ОГРН(?:ИП)?<\/strong>\s*<strong[^>]*>(\d{13,15})<\/strong>/i, 1, '');
        const regDate = extract(/Дата регистрации<\/div>\s*<div>([^<]+)<\/div>/i, 1);

        let directorTitle = 'Руководитель';
        let directorName = 'Не найдено';
        if (isIP) {
            directorTitle = 'ИП';
            directorName = name;
        } else {
            const dirMatch = mainHtml.match(/(Генеральный директор|Директор|Руководитель|Президент|Управляющий)[^<]*<\/strong>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
            if (dirMatch) {
                directorTitle = dirMatch[1].trim();
                directorName = dirMatch[2].trim();
            }
        }

        const phoneMatch = mainHtml.match(/href="tel:[^"]+">([^<]+)<\/a>/i);
        const phone = phoneMatch ? phoneMatch[1].trim() : 'Нет данных';
        const emailMatch = mainHtml.match(/href="mailto:[^"]+">([^<]+)<\/a>/i);
        const email = emailMatch ? emailMatch[1].trim() : 'Нет данных';

        const empMatch = mainHtml.match(/Среднесписочная численность работников[^<]*?составляет\s*<strong[^>]*>(\d+)<\/strong>\s*человек/i)
                      || mainHtml.match(/Среднесписочная численность[\s\S]*?(\d+)\s*чел/i);
        const employees = empMatch ? empMatch[1] : 'Нет данных';

        function getFinance(html, year, type) {
            if (isIP) return '—';
            const blockRegex = new RegExp(`id="accounting-huge-year-${year}"[\\s\\S]*?>(?:${type})<[\\s\\S]*?<a[^>]*>([\\d,\\-]+)\\s*(?:<span>)?\\s*(млн руб\\.|млрд руб\\.|тыс\\. руб\\.|руб\\.)`, 'i');
            const match = html.match(blockRegex);
            return match ? `${match[1]} ${match[2]}`.replace(/\s+/g, ' ').trim() : 'Нет данных';
        }

        const revenuePrev = getFinance(mainHtml, '2023', 'Выручка');
        const profitPrev = getFinance(mainHtml, '2023', 'Чистая прибыль');
        const capPrev = getFinance(mainHtml, '2023', 'Капитал');

        const revenueLast = getFinance(mainHtml, '2024', 'Выручка');
        const profitLast = getFinance(mainHtml, '2024', 'Чистая прибыль');
        const capLast = getFinance(mainHtml, '2024', 'Капитал');

        const taxesMatch = mainHtml.match(/(Есть сведения о задолженностях по налогам[^<]+)/i);
        const taxes = taxesMatch ? taxesMatch[1].replace(/&nbsp;/g, ' ') : 'Нет долгов';

        const finesMatch = mainHtml.match(/(Есть сведения о пенях и штрафах[^<]+)/i);
        const fines = finesMatch ? finesMatch[1].replace(/&nbsp;/g, ' ') : 'Нет';

        const blocksMatch = mainHtml.match(/(Нет сведений о приостановке операций по счетам|Есть сведения о приостановке операций по счетам)/i);
        const blocks = blocksMatch ? blocksMatch[1] : 'Нет данных';

        const rnpMatch = mainHtml.match(/(Не входит в реестр недобросовестных поставщиков|Входит в реестр недобросовестных поставщиков)/i);
        const rnp = rnpMatch ? rnpMatch[1] : 'Нет данных';

        const bankrotMatch = mainHtml.match(/(Нет сообщений о банкротстве|Сообщения о банкротстве найдены)/i);
        const bankrot = bankrotMatch ? bankrotMatch[1] : 'Нет данных';

        const leasingMatch = mainHtml.match(/(Заключени[ея] договора финансовой аренды \(лизинга\))/i);
        const leasing = leasingMatch ? 'Есть договоры лизинга' : 'Нет / Не найдено';

        let arbAll = '0 дел';
        let arbAllSum = '0 руб.';
        const arbCountMatch = mainHtml.match(/В роли ответчика[\s\S]*?<a[^>]*>(\d+)<\/a>/i);
        if (arbCountMatch) {
            arbAll = `${arbCountMatch[1]} дел`;
            if (arbCountMatch[1] !== '0') {
                const arbSumMatch = mainHtml.match(/В роли ответчика[\s\S]*?<a[^>]*>\d+<\/a>[\s\S]*?<div[^>]*>(?:около\s*)?([\d,]+\s*(?:млн|млрд|тыс\.)?\s*руб\.)/i);
                if (arbSumMatch) arbAllSum = arbSumMatch[1];
            }
        }

        let totalGzCount = '0 шт.';
        let totalGzSum = '0 руб.';
        const fz44Match = mainHtml.match(/<td>44-ФЗ<\/td>\s*<td>(\d+)<\/td>\s*<td>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?<\/td>/i);
        if (fz44Match) {
            totalGzCount = fz44Match[1] + ' шт.';
            totalGzSum = fz44Match[2].trim();
        }

        let result = {
            isIP, name, ogrn, regDate, directorTitle, directorName, phone, email, employees,
            revenuePrev, profitPrev, capPrev, revenueLast, profitLast, capLast,
            taxes, fines, blocks, rnp, bankrot, leasing,
            gzAll: '0 шт.', gz2025: '0 шт.', gz2026: '0 шт.', maxContract: 'Нет данных',
            arbAll, arbAllSum, arb2025: '0 дел', arb2026: '0 дел',
            riskLevel: '🟢 Низкий риск'
        };

        if (ogrn) {
            let maxContractVal = 0;
            const apiPath = isIP ? `people/inn/${inn}` : `id/${ogrn}`;

            const fetchGzData = async (year) => {
                const url = `https://companium.ru/${apiPath}/purchases?role=supplier&law=44${year ? '&year='+year : ''}`;
                try {
                    const resHtml = await fetchUrl(url);
                    let countMatch = resHtml.match(/Контрактов:\s*(\d+)/i);
                    let count = countMatch ? parseInt(countMatch[1]) : 0;

                    let yearSum = 0;
                    const regex = /Стоимость контракта<\/div>\s*<div>([\d\s,]+)\s*руб\.<\/div>/gi;
                    let m;
                    while ((m = regex.exec(resHtml)) !== null) {
                        let val = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
                        yearSum += val;
                        if (val > maxContractVal) maxContractVal = val;
                    }
                    return { count, sum: yearSum };
                } catch (e) {
                    return { count: 0, sum: 0 };
                }
            };

            const [gzAllData, gz2025, gz2026] = await Promise.all([
                fetchGzData(''),
                fetchGzData('2025'),
                fetchGzData('2026')
            ]);

            result.gzAll = totalGzSum !== '0 руб.' ? `${totalGzCount} (${totalGzSum})` : (gzAllData.count > 0 ? `${gzAllData.count} шт. (${formatMoneyVal(gzAllData.sum)})` : '0 шт.');
            result.gz2025 = gz2025.count > 0 ? `${gz2025.count} шт. (${formatMoneyVal(gz2025.sum)})` : '0 шт.';
            result.gz2026 = gz2026.count > 0 ? `${gz2026.count} шт. (${formatMoneyVal(gz2026.sum)})` : '0 шт.';
            if (maxContractVal > 0) result.maxContract = formatMoneyVal(maxContractVal);

            try {
                const arbUrl = `https://companium.ru/${apiPath}/legal-cases?role=defendant&actual=true`;
                const arbHtml = await fetchUrl(arbUrl);

                let arb2025Count = 0, arb2025Sum = 0;
                let arb2026Count = 0, arb2026Sum = 0;

                const caseRegex = /от \d{1,2} [а-яА-Я]+ (\d{4}) года<\/div>[\s\S]*?Сумма исковых требований:\s*([\d,]+)?\s*(млн|млрд|тыс\.)?\s*руб\./gi;
                let match;

                while ((match = caseRegex.exec(arbHtml)) !== null) {
                    const year = match[1];
                    if (year === '2025' || year === '2026') {
                        let sum = 0;
                        if (match[2]) {
                            sum = parseFloat(match[2].replace(',', '.'));
                            const mult = match[3];
                            if (mult === 'млн') sum *= 1e6;
                            else if (mult === 'млрд') sum *= 1e9;
                            else if (mult === 'тыс.') sum *= 1e3;
                        }

                        if (year === '2025') { arb2025Count++; arb2025Sum += sum; }
                        else if (year === '2026') { arb2026Count++; arb2026Sum += sum; }
                    }
                }

                result.arb2025 = arb2025Count > 0 ? `${arb2025Count} дел (${formatMoneyVal(arb2025Sum)})` : '0 дел';
                result.arb2026 = arb2026Count > 0 ? `${arb2026Count} дел (${formatMoneyVal(arb2026Sum)})` : '0 дел';
            } catch (e) {
                console.log("Ошибка загрузки арбитражей:", e);
            }
        }

        if (bankrot.includes("найдены") || blocks.includes("Есть сведения") || rnp.includes("Входит в реестр") || capLast.includes("-")) {
            result.riskLevel = "🔴 ВЫСОКИЙ РИСК (Стоп-фактор / Отрицат. капитал)";
        } else if (taxes !== 'Нет долгов' || fines !== 'Нет' || result.arbAll !== '0 дел') {
            result.riskLevel = "🟡 Средний риск (Есть суды, долги или штрафы)";
        }

        if (result.riskLevel === '🟢 Низкий риск' && !isIP && (employees === '0' || employees === '1')) {
            result.riskLevel = "🟡 Внимание: 0-1 сотрудник";
        }

        return result;
    }

    function showWidget(data, inn) {
        const oldPanel = document.getElementById('tm-companium-widget');
        if (oldPanel) oldPanel.remove();

        const colorize = (text, isGoodCondition) => isGoodCondition ? `<span style="color:#2e7d32;">${text}</span>` : `<span style="color:#d32f2f; font-weight:bold;">${text}</span>`;

        const financeHtml = data.isIP ? '' : `
            <div style="background: #f5f5f5; padding: 6px; border-radius: 4px; margin-bottom: 8px;">
                <b style="color:#424242;">💰 Финансы (2024 / 2023):</b><br>
                <b>Выручка:</b> ${data.revenueLast} / ${data.revenuePrev}<br>
                <b>Прибыль:</b> ${data.profitLast} / ${data.profitPrev}<br>
                <b>Капитал:</b> ${data.capLast} / ${data.capPrev}
            </div>
        `;

        const summaryHTML = `
            <div style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.5;">
                <h3 style="margin: 0 0 10px 0; color: #1976d2; font-size: 15px; border-bottom: 2px solid #1976d2; padding-bottom: 5px;">
                    Сводка: ИНН ${inn}
                </h3>

                <div style="font-weight: bold; font-size: 14px; margin-bottom: 10px; text-align: center;">
                    ${data.riskLevel}
                </div>

                <div style="margin-bottom: 10px;">
                    <b>Компания/ИП:</b> ${data.name}<br>
                    <b>ОГРН(ИП):</b> ${data.ogrn}<br>
                    <b>Дата рег.:</b> ${data.regDate}<br>
                    <b>${data.directorTitle}:</b> ${data.directorName}<br>
                    <b>Контакты:</b> ${data.phone} | ${data.email}<br>
                    ${!data.isIP ? `<b>Сотрудники (СЧР):</b> ${data.employees}` : ''}
                </div>

                ${financeHtml}

                <div style="background: #e3f2fd; padding: 6px; border-radius: 4px; margin-bottom: 8px;">
                    <b style="color:#1565c0;">🏛️ Госзакупки (44-ФЗ):</b><br>
                    <b>Всего:</b> ${data.gzAll}<br>
                    <b>2025:</b> ${data.gz2025}<br>
                    <b>2026:</b> ${data.gz2026}<br>
                    <b>Макс. контракт:</b> <span style="color:#1565c0; font-weight:bold;">${data.maxContract}</span>
                </div>

                <div style="background: #fff3e0; padding: 6px; border-radius: 4px; margin-bottom: 8px;">
                    <b style="color:#e65100;">⚖️ Безопасность и риски:</b><br>
                    <b>Суды (Ответчик):</b> ${colorize(data.arbAll, data.arbAll === '0 дел')} <span style="font-size: 11px;">(${data.arbAllSum})<br>(2025: ${data.arb2025}, 2026: ${data.arb2026})</span><br>
                    <b>Налоги/Долги:</b> ${colorize(data.taxes, data.taxes === 'Нет долгов')}<br>
                    <b>Штрафы:</b> ${colorize(data.fines, data.fines === 'Нет')}<br>
                    <b>Счета:</b> ${colorize(data.blocks, data.blocks.includes('Нет'))}<br>
                    <b>РНП:</b> ${colorize(data.rnp, data.rnp.includes('Не входит'))}<br>
                    <b>Банкротство:</b> ${colorize(data.bankrot, data.bankrot.includes('Нет'))}<br>
                    <b>Лизинг:</b> ${data.leasing}
                </div>

                <div style="margin-top: 10px; text-align: center; display: flex; flex-direction: column; gap: 8px;">
                    <button id="tm-copy-data-btn" style="width: 100%; padding: 6px; background: #eceff1; border: 1px solid #cfd8dc; border-radius: 4px; cursor: pointer; font-weight: bold; color: #37474f; transition: 0.2s;">
                        📋 Скопировать всё
                    </button>
                    <a href="https://companium.ru/search?query=${inn}" target="_blank" style="color: #1976d2; text-decoration: none; font-size: 12px; font-weight: bold;">
                        Открыть полную карточку ↗
                    </a>
                </div>
            </div>
        `;

        const panel = document.createElement('div');
        panel.id = 'tm-companium-widget';
        panel.innerHTML = summaryHTML;
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 360px;
            max-height: 85vh;
            overflow-y: auto;
            background: #ffffff;
            border: 1px solid #cfd8dc;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            z-index: 999999;
            color: #333;
            transition: all 0.3s ease-in-out;
        `;

        const closeBtn = document.createElement('span');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
            position: absolute;
            top: 8px;
            right: 12px;
            cursor: pointer;
            color: #9e9e9e;
            font-size: 20px;
            font-weight: bold;
            line-height: 1;
        `;
        closeBtn.onmouseover = () => closeBtn.style.color = '#333';
        closeBtn.onmouseout = () => closeBtn.style.color = '#9e9e9e';
        closeBtn.onclick = () => panel.remove();

        panel.appendChild(closeBtn);
        document.body.appendChild(panel);

        const copyBtn = document.getElementById('tm-copy-data-btn');
        copyBtn.onclick = () => {
            let textToCopy = `Сводка: ИНН ${inn}\n`;
            textToCopy += `Риск: ${data.riskLevel}\n\n`;
            textToCopy += `Наименование: ${data.name}\n`;
            textToCopy += `ОГРН(ИП): ${data.ogrn}\n`;
            textToCopy += `Дата рег.: ${data.regDate}\n`;
            textToCopy += `${data.directorTitle}: ${data.directorName}\n`;
            textToCopy += `Контакты: ${data.phone} | ${data.email}\n`;
            if (!data.isIP) textToCopy += `Сотрудники (СЧР): ${data.employees}\n`;

            if (!data.isIP) {
                textToCopy += `\n💰 Финансы (2024 / 2023):\n`;
                textToCopy += `Выручка: ${data.revenueLast} / ${data.revenuePrev}\n`;
                textToCopy += `Прибыль: ${data.profitLast} / ${data.profitPrev}\n`;
                textToCopy += `Капитал: ${data.capLast} / ${data.capPrev}\n`;
            }

            textToCopy += `\n🏛️ Госзакупки (44-ФЗ):\n`;
            textToCopy += `Всего: ${data.gzAll}\n`;
            textToCopy += `2025: ${data.gz2025}\n`;
            textToCopy += `2026: ${data.gz2026}\n`;
            textToCopy += `Макс. контракт: ${data.maxContract}\n`;

            textToCopy += `\n⚖️ Безопасность и риски:\n`;
            textToCopy += `Суды (Ответчик): ${data.arbAll} (${data.arbAllSum}) (2025: ${data.arb2025}, 2026: ${data.arb2026})\n`;
            textToCopy += `Налоги/Долги: ${data.taxes}\n`;
            textToCopy += `Штрафы: ${data.fines}\n`;
            textToCopy += `Счета: ${data.blocks}\n`;
            textToCopy += `РНП: ${data.rnp}\n`;
            textToCopy += `Банкротство: ${data.bankrot}\n`;
            textToCopy += `Лизинг: ${data.leasing}\n`;

            navigator.clipboard.writeText(textToCopy).then(() => {
                copyBtn.textContent = '✅ Скопировано!';
                copyBtn.style.background = '#c8e6c9';
                copyBtn.style.color = '#2e7d32';
                setTimeout(() => {
                    copyBtn.textContent = '📋 Скопировать всё';
                    copyBtn.style.background = '#eceff1';
                    copyBtn.style.color = '#37474f';
                }, 2000);
            }).catch(err => {
                console.error('Ошибка копирования: ', err);
                copyBtn.textContent = '❌ Ошибка';
            });
        };
    }
})();
