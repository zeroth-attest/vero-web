// Shared country dial codes for SMS phone-number entry.
// Combined with a national-format input to produce E.164 (e.g. +447911123456).
window.VERO_COUNTRY_CODES = [
  { code: 'US', name: 'United States',   dial: '1'   },
  { code: 'CA', name: 'Canada',          dial: '1'   },
  { code: 'GB', name: 'United Kingdom',  dial: '44'  },
  { code: 'AU', name: 'Australia',       dial: '61'  },
  { code: 'AR', name: 'Argentina',       dial: '54'  },
  { code: 'AT', name: 'Austria',         dial: '43'  },
  { code: 'BE', name: 'Belgium',         dial: '32'  },
  { code: 'BR', name: 'Brazil',          dial: '55'  },
  { code: 'CL', name: 'Chile',           dial: '56'  },
  { code: 'CN', name: 'China',           dial: '86'  },
  { code: 'CO', name: 'Colombia',        dial: '57'  },
  { code: 'CZ', name: 'Czechia',         dial: '420' },
  { code: 'DK', name: 'Denmark',         dial: '45'  },
  { code: 'EG', name: 'Egypt',           dial: '20'  },
  { code: 'FI', name: 'Finland',         dial: '358' },
  { code: 'FR', name: 'France',          dial: '33'  },
  { code: 'DE', name: 'Germany',         dial: '49'  },
  { code: 'GR', name: 'Greece',          dial: '30'  },
  { code: 'HK', name: 'Hong Kong',       dial: '852' },
  { code: 'IN', name: 'India',           dial: '91'  },
  { code: 'ID', name: 'Indonesia',       dial: '62'  },
  { code: 'IE', name: 'Ireland',         dial: '353' },
  { code: 'IL', name: 'Israel',          dial: '972' },
  { code: 'IT', name: 'Italy',           dial: '39'  },
  { code: 'JP', name: 'Japan',           dial: '81'  },
  { code: 'KR', name: 'South Korea',     dial: '82'  },
  { code: 'MY', name: 'Malaysia',        dial: '60'  },
  { code: 'MX', name: 'Mexico',          dial: '52'  },
  { code: 'NL', name: 'Netherlands',     dial: '31'  },
  { code: 'NZ', name: 'New Zealand',     dial: '64'  },
  { code: 'NG', name: 'Nigeria',         dial: '234' },
  { code: 'NO', name: 'Norway',          dial: '47'  },
  { code: 'PE', name: 'Peru',            dial: '51'  },
  { code: 'PH', name: 'Philippines',     dial: '63'  },
  { code: 'PL', name: 'Poland',          dial: '48'  },
  { code: 'PT', name: 'Portugal',        dial: '351' },
  { code: 'RU', name: 'Russia',          dial: '7'   },
  { code: 'SA', name: 'Saudi Arabia',    dial: '966' },
  { code: 'SG', name: 'Singapore',       dial: '65'  },
  { code: 'ZA', name: 'South Africa',    dial: '27'  },
  { code: 'ES', name: 'Spain',           dial: '34'  },
  { code: 'SE', name: 'Sweden',          dial: '46'  },
  { code: 'CH', name: 'Switzerland',     dial: '41'  },
  { code: 'TH', name: 'Thailand',        dial: '66'  },
  { code: 'TR', name: 'Turkey',          dial: '90'  },
  { code: 'UA', name: 'Ukraine',         dial: '380' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971' },
  { code: 'VN', name: 'Vietnam',         dial: '84'  },
];

// Combine a country dial code with a user-entered national-format number
// into E.164 (e.g. +447911123456). If the user already typed a leading '+',
// trust their input is international format and just clean separators.
window.VERO_TO_E164 = function (rawInput, dialCode) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  let digits = trimmed.replace(/\D/g, '');
  // Strip a single trunk prefix '0' (UK/EU/AU national format).
  if (digits.startsWith('0')) digits = digits.slice(1);
  const dial = String(dialCode || '').replace(/\D/g, '') || '1';
  return '+' + dial + digits;
};

// Render <option> elements into a <datalist> so a paired <input list="...">
// behaves as a combo box (type-to-search OR pick from the list).
// Each option's value is the "+<dial>" string the user picks; the label shows
// the country name so users can find it without knowing the dial code.
window.VERO_POPULATE_COUNTRY_DATALIST = function (datalistEl) {
  datalistEl.innerHTML = '';
  for (const c of window.VERO_COUNTRY_CODES) {
    const opt = document.createElement('option');
    opt.value = `+${c.dial}`;
    opt.label = c.name;
    opt.textContent = c.name;
    datalistEl.appendChild(opt);
  }
};
