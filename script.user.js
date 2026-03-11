// ==UserScript==
// @name         Анализ клиента
// @namespace    http://tampermonkey.net/
// @version      4.5
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

    setInterval(() => {
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

        if (innElement && innText.length >= 10) {
            if (!innElement.parentNode.querySelector('#tm-check-companium-btn')) {
                const oldBtn = document.getElementById('tm-check-companium-btn');
                if (oldBtn) {
                    oldBtn.remove();
                }
                createCheckButton(innElement, innText);
            }
        }
    }, 1000);

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
                console.error("Ошибка парсинга:", error);
                
                if (error.message.includes('429') || error.message.includes('403')) {
                    showErrorWidget(inn);
                } else {
                    alert("Не удалось загрузить данные: " + error.message);
                }
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

        let arbAll = '0 дел', arbAllSum = '0 руб.', arb2025 = '0 дел', arb2026 = '0 дел';
        const arbCountMatch = mainHtml.match(/В роли ответчика[\s\S]*?<a[^>]*>(\d+)<\/a>/i);
        if (arbCountMatch) {
            arbAll = `${arbCountMatch[1]} дел`;
            if (arbCountMatch[1] !== '0') {
                const arbSumMatch = mainHtml.match(/В роли ответчика[\s\S]*?<a[^>]*>\d+<\/a>[\s\S]*?<div[^>]*>(?:около\s*)?([\d,]+\s*(?:млн|млрд|тыс\.)?\s*руб\.)/i);
                if (arbSumMatch) arbAllSum = arbSumMatch[1];
            }
        }

        let result = {
            isIP, name, ogrn, regDate, directorTitle, directorName, phone, email, employees,
            revenuePrev, profitPrev, capPrev, revenueLast, profitLast, capLast,
            taxes, fines, blocks, rnp, bankrot, leasing,
            gz44All: '0 шт.', gz44_2025: '0 шт.', gz44_2026: '0 шт.', gz44Max: 'Нет данных',
            gz223All: '0 шт.', gz223_2025: '0 шт.', gz223_2026: '0 шт.', gz223Max: 'Нет данных',
            fsspTotalCount: '0 шт.', fsspTotalSum: '0 руб.', fsspDebt: '0 руб.', fssp2025: '0 шт.', fssp2026: '0 шт.',
            arbAll, arbAllSum, arb2025, arb2026,
            riskLevel: '🟢 Низкий риск'
        };

        if (ogrn) {
            const apiPath = isIP ? `people/inn/${inn}` : `id/${ogrn}`;

            const fetchGzData = async (law, year) => {
                try {
                    const resHtml = await fetchUrl(`https://companium.ru/${apiPath}/purchases?role=supplier&law=${law}${year ? '&year='+year : ''}`);
                    let count = (resHtml.match(/Контрактов:\s*(\d+)/i) || [])[1] || 0;
                    let yearSum = 0, maxVal = 0, m;
                    const regex = /Стоимость контракта<\/div>\s*<div>([\d\s,]+)\s*руб\.<\/div>/gi;
                    while ((m = regex.exec(resHtml)) !== null) {
                        let val = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
                        yearSum += val;
                        if (val > maxVal) maxVal = val;
                    }
                    return { count: parseInt(count), sum: yearSum, maxVal };
                } catch (e) { return { count: 0, sum: 0, maxVal: 0 }; }
            };

            const fz44Match = mainHtml.match(/<td>44-ФЗ<\/td>\s*<td>(\d+)<\/td>\s*<td>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?<\/td>/i);
            if (fz44Match) {
                let totalGzSum = fz44Match[2].trim();
                const [all, y25, y26] = await Promise.all([ fetchGzData('44', ''), fetchGzData('44', '2025'), fetchGzData('44', '2026') ]);
                result.gz44All = totalGzSum !== '0 руб.' ? `${fz44Match[1]} шт. (${totalGzSum})` : (all.count > 0 ? `${all.count} шт. (${formatMoneyVal(all.sum)})` : '0 шт.');
                result.gz44_2025 = y25.count > 0 ? `${y25.count} шт. (${formatMoneyVal(y25.sum)})` : '0 шт.';
                result.gz44_2026 = y26.count > 0 ? `${y26.count} шт. (${formatMoneyVal(y26.sum)})` : '0 шт.';
                let max44 = Math.max(all.maxVal, y25.maxVal, y26.maxVal);
                if (max44 > 0) result.gz44Max = formatMoneyVal(max44);
            }

            const fz223Match = mainHtml.match(/<td>223-ФЗ<\/td>\s*<td>(\d+)<\/td>\s*<td>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?<\/td>/i);
            if (fz223Match) {
                let totalGzSum = fz223Match[2].trim();
                const [all, y25, y26] = await Promise.all([ fetchGzData('223', ''), fetchGzData('223', '2025'), fetchGzData('223', '2026') ]);
                result.gz223All = totalGzSum !== '0 руб.' ? `${fz223Match[1]} шт. (${totalGzSum})` : (all.count > 0 ? `${all.count} шт. (${formatMoneyVal(all.sum)})` : '0 шт.');
                result.gz223_2025 = y25.count > 0 ? `${y25.count} шт. (${formatMoneyVal(y25.sum)})` : '0 шт.';
                result.gz223_2026 = y26.count > 0 ? `${y26.count} шт. (${formatMoneyVal(y26.sum)})` : '0 шт.';
                let max223 = Math.max(all.maxVal, y25.maxVal, y26.maxVal);
                if (max223 > 0) result.gz223Max = formatMoneyVal(max223);
            }

            if (arbCountMatch && arbCountMatch[1] !== '0') {
                try {
                    const arbHtml = await fetchUrl(`https://companium.ru/${apiPath}/legal-cases?role=defendant&actual=true`);
                    let a25C = 0, a25S = 0, a26C = 0, a26S = 0, match;
                    const caseRegex = /от \d{1,2} [а-яА-Я]+ (\d{4}) года<\/div>[\s\S]*?Сумма исковых требований:\s*([\d,]+)?\s*(млн|млрд|тыс\.)?\s*руб\./gi;
                    while ((match = caseRegex.exec(arbHtml)) !== null) {
                        const year = match[1];
                        if (year === '2025' || year === '2026') {
                            let sum = 0;
                            if (match[2]) {
                                sum = parseFloat(match[2].replace(',', '.'));
                                if (match[3] === 'млн') sum *= 1e6; else if (match[3] === 'млрд') sum *= 1e9; else if (match[3] === 'тыс.') sum *= 1e3;
                            }
                            if (year === '2025') { a25C++; a25S += sum; } else if (year === '2026') { a26C++; a26S += sum; }
                        }
                    }
                    result.arb2025 = a25C > 0 ? `${a25C} дел (${formatMoneyVal(a25S)})` : '0 дел';
                    result.arb2026 = a26C > 0 ? `${a26C} дел (${formatMoneyVal(a26S)})` : '0 дел';
                } catch (e) { console.log("Ошибка арбитража:", e); }
            }

            if (mainHtml.includes('/enforcements')) {
                try {
                    const fsspHtml = await fetchUrl(`https://companium.ru/${apiPath}/enforcements`);
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(fsspHtml, 'text/html');

                    const countEl = Array.from(doc.querySelectorAll('div')).find(el => el.textContent.includes('Исполнительных производств:'));
                    if (countEl) {
                        const m = countEl.textContent.match(/:\s*(\d+)/);
                        if (m) result.fsspTotalCount = m[1] + ' шт.';
                    }
                    doc.querySelectorAll('td').forEach(td => {
                        if (td.textContent.includes('Общая сумма') && td.nextElementSibling) result.fsspTotalSum = td.nextElementSibling.textContent.trim();
                        if (td.textContent.includes('Непогашенная задолженность') && td.nextElementSibling) result.fsspDebt = td.nextElementSibling.textContent.trim();
                    });

                    let f25C = 0, f25S = 0, f26C = 0, f26S = 0;
                    doc.querySelectorAll('table.table-lg tbody tr').forEach(row => {
                        const text = row.textContent.replace(/\s+/g, ' '); // убираем переносы и лишние пробелы
                        const yearMatch = text.match(/от \d+ [а-яА-Я]+ (\d{4}) года/);
                        if (yearMatch) {
                            const year = yearMatch[1];
                            if (year === '2025' || year === '2026') {
                                let debtVal = 0;
                                const sumMatch = text.match(/задолженности\s*([\d, ]+)\s*(тыс\.|млн|млрд)?\s*руб\.?\s*\/\s*([\d, ]+)\s*(тыс\.|млн|млрд)?\s*руб\.?/i);
                                if (sumMatch) {
                                    debtVal = parseFloat(sumMatch[3].replace(/ /g, '').replace(',', '.'));
                                    if (sumMatch[4] === 'тыс.') debtVal *= 1e3; else if (sumMatch[4] === 'млн') debtVal *= 1e6; else if (sumMatch[4] === 'млрд') debtVal *= 1e9;
                                } else {
                                    const singleMatch = text.match(/задолженности\s*([\d, ]+)\s*(тыс\.|млн|млрд)?\s*руб\.?/i);
                                    if (singleMatch) {
                                        debtVal = parseFloat(singleMatch[1].replace(/ /g, '').replace(',', '.'));
                                        if (singleMatch[2] === 'тыс.') debtVal *= 1e3; else if (singleMatch[2] === 'млн') debtVal *= 1e6; else if (singleMatch[2] === 'млрд') debtVal *= 1e9;
                                    }
                                }
                                if (year === '2025') { f25C++; f25S += debtVal; } else if (year === '2026') { f26C++; f26S += debtVal; }
                            }
                        }
                    });

                    if (f25C > 0) result.fssp2025 = `${f25C} шт. (${formatMoneyVal(f25S)})`;
                    if (f26C > 0) result.fssp2026 = `${f26C} шт. (${formatMoneyVal(f26S)})`;

                } catch(e) { console.error("Ошибка ФССП:", e); }
            }
        }

        if (bankrot.includes("найдены") || blocks.includes("Есть сведения") || rnp.includes("Входит в реестр") || capLast.includes("-")) {
            result.riskLevel = "🔴 ВЫСОКИЙ РИСК (Стоп-фактор / Отрицат. капитал)";
        } else if (taxes !== 'Нет долгов' || fines !== 'Нет' || result.arbAll !== '0 дел' || parseInt(result.fsspTotalCount) > 0) {
            result.riskLevel = "🟡 Средний риск (Суды, долги, ФССП или штрафы)";
        }

        if (result.riskLevel === '🟢 Низкий риск' && !isIP && (employees === '0' || employees === '1')) {
            result.riskLevel = "🟡 Внимание: 0-1 сотрудник";
        }

        return result;
    }

    function showErrorWidget(inn) {
        const captchaUrl = `https://companium.ru/search?query=${inn}`;
        const errorHTML = `
            <div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5; text-align: center; padding: 10px 0;">
                <h3 style="margin: 0 0 10px 0; color: #d32f2f; font-size: 16px;">🤖 Проверка на робота</h3>
                <p style="margin-bottom: 15px; color: #333; font-size: 13px;">Сайт временно заблокировал запросы (Ошибка 429).</p>
                <a href="${captchaUrl}" target="_blank" style="display: inline-block; padding: 10px 16px; background: #d32f2f; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    👉 Пройти капчу на сайте ↗
                </a>
                <p style="margin-top: 15px; font-size: 11px; color: #757575;">После прохождения капчи закройте панель и нажмите «Анализ» еще раз.</p>
            </div>
        `;
        createPanel(errorHTML);
    }

    function createPanel(innerHTML) {
        const oldPanel = document.getElementById('tm-companium-widget');
        if (oldPanel) oldPanel.remove();

        const panel = document.createElement('div');
        panel.id = 'tm-companium-widget';
        panel.innerHTML = innerHTML;
        panel.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; width: 380px; max-height: 85vh; overflow-y: auto;
            background: #ffffff; border: 1px solid #cfd8dc; border-radius: 8px; padding: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2); z-index: 999999; color: #333; transition: all 0.3s;
        `;

        const closeBtn = document.createElement('span');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `position: absolute; top: 8px; right: 12px; cursor: pointer; color: #9e9e9e; font-size: 20px; font-weight: bold; line-height: 1;`;
        closeBtn.onmouseover = () => closeBtn.style.color = '#333';
        closeBtn.onmouseout = () => closeBtn.style.color = '#9e9e9e';
        closeBtn.onclick = () => panel.remove();

        panel.appendChild(closeBtn);
        document.body.appendChild(panel);
        return panel;
    }

    function showWidget(data, inn) {
        const colorize = (text, isGood) => isGood ? `<span style="color:#2e7d32;">${text}</span>` : `<span style="color:#d32f2f; font-weight:bold;">${text}</span>`;

        const summaryHTML = `
            <div style="font-family: Arial, sans-serif; font-size: 13px; line-height: 1.5;">
                <h3 style="margin: 0 0 10px 0; color: #1976d2; font-size: 15px; border-bottom: 2px solid #1976d2; padding-bottom: 5px;">
                    Сводка: ИНН ${inn}
                </h3>

                <div style="font-weight: bold; font-size: 14px; margin-bottom: 10px; text-align: center;">${data.riskLevel}</div>

                <div style="margin-bottom: 10px;">
                    <b>Компания/ИП:</b> ${data.name}<br>
                    <b>ОГРН(ИП):</b> ${data.ogrn} | <b>Дата рег.:</b> ${data.regDate}<br>
                    <b>${data.directorTitle}:</b> ${data.directorName}<br>
                    ${!data.isIP ? `<b>Сотрудники (СЧР):</b> ${data.employees}` : ''}
                </div>

                ${!data.isIP ? `
                <div style="background: #f5f5f5; padding: 6px; border-radius: 4px; margin-bottom: 8px;">
                    <b style="color:#424242;">💰 Финансы (2024 / 2023):</b><br>
                    <b>Выручка:</b> ${data.revenueLast} / ${data.revenuePrev}<br>
                    <b>Прибыль:</b> ${data.profitLast} / ${data.profitPrev}<br>
                    <b>Капитал:</b> ${data.capLast} / ${data.capPrev}
                </div>` : ''}

                <div style="background: #ffebee; padding: 6px; border-radius: 4px; margin-bottom: 8px;">
                    <b style="color:#c62828;">👮 Исполнительные производства (ФССП):</b><br>
                    <b>Всего:</b> ${colorize(data.fsspTotalCount, data.fsspTotalCount === '0 шт.')} <span style="font-size: 11px;">(Сумма: ${data.fsspTotalSum}, Долг: ${data.fsspDebt})</span><br>
                    <b>2025:</b> ${data.fssp2025} | <b>2026:</b> ${data.fssp2026}
                </div>

                <div style="background: #e3f2fd; padding: 6px; border-radius: 4px; margin-bottom: 8px;">
                    <b style="color:#1565c0;">🏛️ Госзакупки (44-ФЗ):</b><br>
                    <b>Всего:</b> ${data.gz44All}<br>
                    <b>2025:</b> ${data.gz44_2025} | <b>2026:</b> ${data.gz44_2026}<br>
                    <b>Макс. контракт:</b> <span style="color:#1565c0; font-weight:bold;">${data.gz44Max}</span>
                </div>

                <div style="background: #e0f7fa; padding: 6px; border-radius: 4px; margin-bottom: 8px;">
                    <b style="color:#00838f;">🏛️ Госзакупки (223-ФЗ):</b><br>
                    <b>Всего:</b> ${data.gz223All}<br>
                    <b>2025:</b> ${data.gz223_2025} | <b>2026:</b> ${data.gz223_2026}<br>
                    <b>Макс. контракт:</b> <span style="color:#00838f; font-weight:bold;">${data.gz223Max}</span>
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

        createPanel(summaryHTML);

        const copyBtn = document.getElementById('tm-copy-data-btn');
        copyBtn.onclick = () => {
            let txt = `Сводка: ИНН ${inn}\nРиск: ${data.riskLevel}\n\n`;
            txt += `Наименование: ${data.name}\nОГРН: ${data.ogrn} | Дата рег.: ${data.regDate}\n${data.directorTitle}: ${data.directorName}\n`;
            if (!data.isIP) txt += `Сотрудники (СЧР): ${data.employees}\n\n💰 Финансы (2024 / 2023):\nВыручка: ${data.revenueLast} / ${data.revenuePrev}\nПрибыль: ${data.profitLast} / ${data.profitPrev}\nКапитал: ${data.capLast} / ${data.capPrev}\n`;
            
            txt += `\n👮 Исполнительные производства (ФССП):\nВсего: ${data.fsspTotalCount} (Сумма: ${data.fsspTotalSum}, Долг: ${data.fsspDebt})\n2025: ${data.fssp2025} | 2026: ${data.fssp2026}\n`;
            
            txt += `\n🏛️ Госзакупки (44-ФЗ):\nВсего: ${data.gz44All}\n2025: ${data.gz44_2025} | 2026: ${data.gz44_2026}\nМакс. контракт: ${data.gz44Max}\n`;
            txt += `\n🏛️ Госзакупки (223-ФЗ):\nВсего: ${data.gz223All}\n2025: ${data.gz223_2025} | 2026: ${data.gz223_2026}\nМакс. контракт: ${data.gz223Max}\n`;
            
            txt += `\n⚖️ Безопасность и риски:\nСуды (Ответчик): ${data.arbAll} (${data.arbAllSum}) (2025: ${data.arb2025}, 2026: ${data.arb2026})\nНалоги/Долги: ${data.taxes}\nШтрафы: ${data.fines}\nСчета: ${data.blocks}\nРНП: ${data.rnp}\nБанкротство: ${data.bankrot}\nЛизинг: ${data.leasing}\n`;

            navigator.clipboard.writeText(txt).then(() => {
                copyBtn.textContent = '✅ Скопировано!';
                copyBtn.style.background = '#c8e6c9';
                copyBtn.style.color = '#2e7d32';
                setTimeout(() => { copyBtn.textContent = '📋 Скопировать всё'; copyBtn.style.background = '#eceff1'; copyBtn.style.color = '#37474f'; }, 2000);
            });
        };
    }
})();
