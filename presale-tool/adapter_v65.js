/*
 * app_v65_source.html이 기대하는 파서 호출 규약과, parser.js(RP)의 견고한 구현 사이의
 * 어댑터. parser.js는 window에 parseAreaSection/parseBalconySection/parseOptionSection을
 * 이미 동일한 형태로 노출하므로 그대로 두고, 형태가 다른 parsePriceSection과 extractMeta만
 * 감싸서 재정의한다.
 *
 * - parsePriceSection: RP는 {midDates:[Date|null x6], priceRows:[{code,floor:{raw,...},...}]}를
 *   반환하지만, 이 앱은 {midDates:[문자열...], priceRows:{code:[{dong,floor(문자열),units,price}]}}를
 *   기대한다.
 * - extractMeta: RP는 open_date를 Date로 반환하지만, 이 앱은 문자열("YYYY.MM.DD")을 기대한다.
 */
(function () {
  var rpParsePriceSection = window.parsePriceSection;
  var rpExtractMeta = window.extractMeta;

  window.parsePriceSection = function (text, codes) {
    var r = rpParsePriceSection(text, codes);
    var priceRows = {};
    codes.forEach(function (c) { priceRows[c] = []; });
    r.priceRows.forEach(function (row) {
      if (!priceRows[row.code]) priceRows[row.code] = [];
      priceRows[row.code].push({
        dong: row.dong || '',
        floor: (row.floor && row.floor.raw) ? row.floor.raw : String(row.floor || ''),
        units: row.units,
        price: row.price
      });
    });
    var midDates = r.midDates.filter(Boolean).map(function (d) { return fmtDate(d); });
    return { midDates: midDates, priceRows: priceRows };
  };

  window.extractMeta = function (text) {
    var m = rpExtractMeta(text);
    return {
      open_date: m.open_date ? fmtDate(m.open_date) : null,
      move_in_year: m.move_in_year,
      move_in_month: m.move_in_month
    };
  };
})();
