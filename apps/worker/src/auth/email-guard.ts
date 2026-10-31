import { badRequest } from '../lib/errors.js';

const STRICT_EMAIL_RE = /^[a-z0-9](?:[a-z0-9._%+\-]{0,62}[a-z0-9])?@([a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?)+)$/i;

/**
 * Trusted global email providers that require real phone/account verification
 * and maintain verified mail infrastructure.
 */
const TRUSTED_MAJOR_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.sa',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'ymail.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'zoho.com',
  'aol.com',
]);

/**
 * Comprehensive blocklist of disposable, temporary, fake, and throwaway email providers
 * (including popular Arabic temp-mail domains like mohmal, moakt, bareed.ws).
 */
const DISPOSABLE_DOMAINS = new Set([
  // Reserved / fake / placeholder domains
  'example.com', 'example.org', 'example.net', 'test.com', 'test.org', 'testing.com',
  'fake.com', 'fakemail.com', 'fakemail.net', 'invalid.com', 'localhost.com', 'none.com',
  'noemail.com', 'nomail.com', 'null.com', 'asdf.com', 'qwerty.com', 'abc.com', 'xyz.com',
  '123.com', 'email.com', 'mail.com',
  // Arabic temporary mail services
  'mohmal.com', 'mohmal.in', 'mohmal.im', 'mohmal.tech', 'moakt.com', 'moakt.co',
  'moakt.ws', 'bareed.ws', 'tmail.ws', 'disbox.net', 'disbox.org', 'tmpmail.net', 'tmpmail.org',
  // Global temporary & burner mail services
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'temp-mail.ru', 'tempmailo.com',
  'tempmailaddress.com', 'tempmail.plus', 'tempmail.dev', 'tempmail.net', 'tempail.com',
  '10minutemail.com', '10minutemail.net', '10minutemail.org', '10minemail.com', '20minutemail.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'cool.fr.nf', 'jetable.fr.nf', 'courriel.fr.nf',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'guerrillamail.de', 'guerrillamail.info', 'guerrillamailblock.com', 'sharklasers.com',
  'grr.la', 'pokemail.net', 'spam4.me',
  'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailinator2.com', 'binkmail.com',
  'safetymail.info', 'suremail.info', 'tradermail.info',
  'trashmail.com', 'trashmail.net', 'trashmail.org', 'trashmail.me', 'trashmail.io',
  'maildrop.cc', 'getnada.com', 'nada.email', 'nada.ltd', 'abyssmail.com', 'boximail.com',
  'dropjar.com', 'getairmail.com', 'givmail.com', 'inboxbear.com', 'robot-mail.com',
  'tafmail.com', 'vomoto.com', 'zetmail.com',
  'dispostable.com', 'throwawaymail.com', 'throwaway.email', 'fakeinbox.com', 'fakemailgenerator.com',
  'mailsac.com', 'emailondeck.com', 'mintemail.com', 'burnermail.io', 'mailnesia.com',
  'mytemp.email', 'tempr.email', 'spamgourmet.com', 'harakirimail.com', 'mailcatch.com',
  'incognitomail.org', 'incognitomail.com', 'anonbox.net', 'anonymbox.com', 'crazymailing.com',
  'deadaddress.com', 'despam.it', 'devnullmail.com', 'discard.email', 'discardmail.com',
  'dodgit.com', 'drdrb.com', 'dump-email.info', 'e4ward.com', 'easytrashmail.com',
  'einrot.com', 'emailias.com', 'emaillime.com', 'emailmiser.com', 'emailsensei.com',
  'emailtemporario.com.br', 'ephemail.net', 'etranquil.com', 'filzmail.com', 'fleckens.hu',
  'FudgeRub.com'.toLowerCase(), 'garliclife.com', 'getonemail.com', 'gishpuppy.com',
  'gowikibooks.com', 'guerrillamail.com', 'Gustr.com'.toLowerCase(), 'haltospam.com',
  'hatespam.org', 'hidemail.de', 'hmamail.com', 'hulapla.de', 'ieatspam.eu', 'ihateyoualot.info',
  'imails.info', 'inboxalias.com', 'inboxclean.com', 'instant-mail.de', 'ipoo.org',
  'irish2me.com', 'jetable.com', 'jetable.org', 'jnxjn.com', 'jourrapide.com', 'kasmail.com',
  'killmail.com', 'killmail.net', 'klzlk.com', 'kulturbetrieb.info', 'kurzepost.de',
  'letthemeatspam.com', 'lhsdv.com', 'lifebyfood.com', 'link2mail.net', 'litedrop.com',
  'lol.ovpn.to', 'lookugly.com', 'lopl.co.cc', 'lortemail.dk', 'lr78.com', 'm4ilweb.info',
  'maboard.com', 'mail-temporaire.fr', 'mail.by', 'mail.mezimages.net', 'mail2rss.org',
  'mail333.com', 'mail4trash.com', 'mailbidon.com', 'mailblocks.com', 'mailbucket.org',
  'mailde.de', 'mailde.info', 'maildx.com', 'maileater.com', 'mailexpire.com', 'mailfa.tk',
  'mailforspam.com', 'mailfree.ga', 'mailfreeonline.com', 'mailfs.com', 'mailguard.me',
  'mailhazard.com', 'mailhz.me', 'mailimate.com', 'mailin8r.com', 'mailinater.com',
  'mailincubator.com', 'mailismagic.com', 'mailjunk.cf', 'mailmate.com', 'mailme.ir',
  'mailme.lv', 'mailmetrash.com', 'mailmoat.com', 'mailnator.com', 'mailnull.com',
  'mailpick.biz', 'mailproxsy.com', 'mailquack.com', 'mailrock.biz', 'mailshell.com',
  'mailsiphon.com', 'mailslapping.com', 'mailslite.com', 'mailtemp.info', 'mailtothis.com',
  'mailzilla.com', 'makemetheking.com', 'manifestgenerator.com', 'mbx.cc', 'mega.zik.dj',
  'meinspamschutz.de', 'meltmail.com', 'messagebeamer.de', 'mierdamail.com', 'migmail.pl',
  'mintemail.com', 'moburl.com', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf',
  'mt2015.com', 'mx0.wwwnew.eu', 'mycleaninbox.net', 'mypartyclip.de', 'myphantomemail.com',
  'myspaceinc.com', 'mytempemail.com', 'mytrashmail.com', 'neomailbox.com', 'nepwk.com',
  'nervmich.net', 'nervtmich.net', 'netmails.com', 'netmails.net', 'netzidiot.de',
  'neverbox.com', 'no-spam.ws', 'nobulk.com', 'noclickemail.com', 'nogmailspam.info',
  'nomail.xl.cx', 'nomail2me.com', 'nomorespamemails.com', 'nospam.ze.tc', 'nospam4.us',
  'nospamfor.us', 'nospamthanks.info', 'notmailinator.com', 'nowmymail.com', 'nurfuerspam.de',
  'nus.edu.sg.fake', 'nwldx.com', 'objectmail.com', 'obobbo.com', 'oneoffemail.com',
  'onewaymail.com', 'oopi.org', 'ordinaryamerican.net', 'otherinbox.com', 'ourklips.com',
  'outlawspam.com', 'ovpn.to', 'owlpic.com', 'pancakemail.com', 'pimpedupmyspace.com',
  'pjjkp.com', 'politikerclub.de', 'poofy.org', 'pookmail.com', 'privacy.net', 'proxymail.eu',
  'prtnx.com', 'punkass.com', 'putthisinyourspamdatabase.com', 'qq.com.fake', 'quickinbox.com',
  'rcpt.at', 'reallymymail.com', 'recode.me', 'recursor.net', 'regbypass.com', 'rmqkr.net',
  'rppkn.com', 'rtrtr.com', 's0ny.net', 'safe-mail.net', 'safersignup.de', 'safetypost.de',
  'sandelf.de', 'saynotospams.com', 'selfdestructingmail.com', 'sendspamhere.com',
  'shiftmail.com', 'shitmail.me', 'shortmail.net', 'sibmail.com', 'skeefmail.com',
  'slaskpost.se', 'slopsbox.com', 'smellfear.com', 'snakemail.com', 'sneakemail.com',
  'sofimail.com', 'sofort-mail.de', 'sogetthis.com', 'soodonims.com', 'spam.la', 'spam.su',
  'spamavert.com', 'spambob.com', 'spambog.com', 'spambog.de', 'spambog.ru', 'spambox.info',
  'spambox.us', 'spamcannon.com', 'spamcero.com', 'spamcon.org', 'spamcorptastic.com',
  'spamcowboy.com', 'spamday.com', 'spamex.com', 'spamfree24.com', 'spamfree24.de',
  'spamfree24.eu', 'spamfree24.info', 'spamfree24.net', 'spamfree24.org', 'spamgoes.in',
  'spamherelots.com', 'spamhereplease.com', 'spamhole.com', 'spamify.com', 'spaminator.de',
  'spamkill.info', 'spaml.com', 'spaml.de', 'spammotel.com', 'spamobox.com', 'spamoff.de',
  'spamslicer.com', 'spamspot.com', 'spamthis.co.uk', 'spamthisplease.com', 'spamtrail.com',
  'spamtroll.net', 'speed.1s.fr', 'supergreatmail.com', 'supermailer.jp', ' superrito.com'.trim(),
  'suremail.info', 'teleworm.us', 'tempalias.com', 'tempe-mail.com', 'tempemail.biz',
  'tempemail.co.za', 'tempemail.com', 'tempemail.net', 'tempinbox.co.uk', 'tempinbox.com',
  'tempmail2.com', 'tempomail.fr', 'temporarily.de', 'temporarioemail.com.br', 'temporaryemail.net',
  'temporaryforwarding.com', 'temporaryinbox.com', 'thanksnospam.info', 'thankyou2010.com',
  'thisisnotmyrealemail.com', 'throwawayemailaddress.com', 'tilien.com', 'tmailinator.com',
  'tradermail.info', 'trash-amil.com', 'trash-mail.at', 'trash-mail.com', 'trash-mail.de',
  'trash2009.com', 'trashemail.de', 'trashymail.com', 'trashymail.net', 'trbvm.com',
  'turual.com', 'twinmail.de', 'tyldd.com', 'uggsrock.com', 'upliftnow.com', 'uplipht.com',
  'venompen.com', 'veryrealemail.com', 'viditag.com', 'viewcastmedia.com', 'webm4il.info',
  'wegwerfadresse.de', 'wegwerfemail.de', 'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org',
  'wetrainbayarea.com', 'wh4f.org', 'whyspam.me', 'willselfdestruct.com', 'winemaven.info',
  'wronghead.com', 'wuzup.net', 'wuzupmail.net', 'wwwnew.eu', 'xagloo.com', 'xemaps.com',
  'xents.com', 'xmaily.com', 'xoxy.net', 'yep.it', 'yogamaven.com', 'yuurok.com',
  'zehnminutenmail.de', 'zippymail.info', 'zoaxe.com', 'zoemail.org',
]);

const DISPOSABLE_KEYWORD_RE =
  /(^|[.\-])(temp-?mail|10min|20min|throwaway|fake-?mail|fakeinbox|trash-?mail|guerrilla|yopmail|mailinator|mohmal|moakt|bareed|burner|disposable|spamgourmet|sharklasers|maildrop|getnada)([.\-]|$)/i;

const INVALID_TLD_RE = /\.(test|example|invalid|localhost|local|internal|onion|lan)$/i;

/**
 * Normalize an email to its canonical identity so `+tag` aliases and Gmail dots
 * cannot be abused to open multiple accounts or evade the 7-day quota lockout.
 */
export function canonicalizeEmail(rawEmail: string): string {
  const clean = rawEmail.trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at === -1) return clean;
  let local = clean.slice(0, at);
  let domain = clean.slice(at + 1);

  if (domain === 'googlemail.com') domain = 'gmail.com';

  // Strip `+subaddress` across all providers
  const plusIdx = local.indexOf('+');
  if (plusIdx !== -1) {
    local = local.slice(0, plusIdx);
  }

  // Strip dots on Gmail (where `a.b.c@gmail.com` === `abc@gmail.com`)
  if (domain === 'gmail.com') {
    local = local.replace(/\./g, '');
  }

  return `${local}@${domain}`;
}

export function isDisposableOrFakeDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (!d || INVALID_TLD_RE.test(d)) return true;
  if (DISPOSABLE_DOMAINS.has(d)) return true;
  if (DISPOSABLE_KEYWORD_RE.test(d)) return true;
  // Check parent domain (e.g. `sub.yopmail.com` -> `yopmail.com`)
  const parts = d.split('.');
  if (parts.length > 2) {
    const root2 = parts.slice(-2).join('.');
    if (DISPOSABLE_DOMAINS.has(root2)) return true;
  }
  return false;
}

/**
 * Detect keyboard mash, repetitive patterns, and random consonant strings
 * like `gsgdgsgdgsgs`, `asdfghjkl`, `qwerty123`, `zxcvbn`, `asdasd`.
 * This protects Brevo's daily sending quota from being drained by bot/spam fake inputs.
 */
export function isGibberishOrFakeLocalPart(localPart: string): boolean {
  const clean = localPart.toLowerCase().trim();
  if (clean.length < 3) return true;

  // 1. Obvious dummy/test words
  if (/^(test|fake|dummy|sample|spam|temp|anon|admin|root|user|asdf|qwerty|zxcvbn|123456|000000)$/i.test(clean)) {
    return true;
  }

  // 2. Pure repetitive single character (e.g. `aaaa`, `1111`, `xxxx`)
  if (/^(.)\1{3,}$/i.test(clean) || /(.)\1{4,}/i.test(clean)) {
    return true;
  }

  // 3. Repeating pattern chunks (e.g. `gsgsgs`, `asdasdasd`, `ababab`, `qweqweqwe`)
  if (/^([a-z0-9]{2,4})\1{2,}$/i.test(clean)) {
    return true;
  }

  // 4. Common keyboard mash walks (QWERTY horizontal & diagonal rows >= 5 chars)
  const KEYBOARD_WALKS = [
    'qwerty', 'wertyu', 'ertyui', 'rtyuio', 'tyuiop',
    'asdfgh', 'sdfghj', 'dfghjk', 'fghjkl',
    'zxcvbn', 'xcvbnm',
    'poiuyt', 'lkjhgf', 'mnbvcx',
    '123456', '234567', '345678', '456789', '567890',
    'qazwsx', 'wsxedc', 'edcrfv', 'rfvtgb', 'tgbzhn',
  ];
  for (const walk of KEYBOARD_WALKS) {
    if (clean.includes(walk)) return true;
  }

  // 5. Consonant and vowel analysis on alphabetic letters
  const lettersOnly = clean.replace(/[^a-z]/g, '');
  if (lettersOnly.length >= 6) {
    // If letters length >= 6 and ZERO vowels -> 100% gibberish (e.g. `gsgdgsgdgsgs`, `bcdfghjkl`)
    if (!/[aeiouy]/i.test(lettersOnly)) {
      return true;
    }

    // Unnatural consonant clusters: 5 or more consecutive consonants (e.g. `gsgdg`, `bcdfgh`)
    if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(lettersOnly)) {
      return true;
    }

    // High vowel starvation on long strings: e.g. length >= 10 with only 1 vowel
    const vowels = lettersOnly.match(/[aeiouy]/gi);
    const vowelCount = vowels ? vowels.length : 0;
    if (lettersOnly.length >= 10 && vowelCount <= 1) {
      return true;
    }
  }

  // 6. Subword analysis: words separated by dots, numbers, hyphens or underscores
  const words = clean.split(/[^a-z]+/i).filter((w) => w.length >= 4);
  for (const w of words) {
    // A 4+ letter word with zero vowels is not a valid human name or word
    if (!/[aeiouy]/i.test(w)) {
      return true;
    }
    // 5+ consecutive consonants in any subword
    if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(w)) {
      return true;
    }
  }

  return false;
}

export interface EmailValidationOptions {
  strictTrustedDomainsOnly?: boolean;
  skipDnsMxCheck?: boolean;
}

/**
 * Full anti-fake & anti-disposable email validation:
 *  1. Strict syntax & `+alias` rejection (blocks `user+1@gmail.com` directly)
 *  2. Anti-gibberish / anti-keyboard-mash protection to defend mailer quota ($0 Brevo shield)
 *  3. Disposable / temp-mail / reserved domain blocklist (250+ domains + Arabic temp-mails)
 *  4. Optional strict trusted-providers-only mode (Gmail / Outlook / Hotmail / iCloud / Yahoo / Proton)
 *  5. Live DNS `MX` record lookup via Cloudflare DoH (`1.1.1.1`) + MX host temp-mail inspection!
 */
export async function validateRealEmail(
  rawEmail: string,
  opts: EmailValidationOptions = {},
): Promise<{ email: string; canonicalEmail: string; domain: string }> {
  const email = (rawEmail ?? '').trim().toLowerCase();
  const match = STRICT_EMAIL_RE.exec(email);
  if (!match || email.length > 160) {
    throw badRequest('يرجى إدخال بريد إلكتروني حقيقي وصحيح.', 'invalid_email');
  }

  const [localPart, domain] = [email.slice(0, email.lastIndexOf('@')), match[1].toLowerCase()];

  if (localPart.includes('+')) {
    throw badRequest('لا يُسمح باستخدام علامة (+) أو العناوين الفرعية في التسجيل.', 'alias_not_allowed');
  }

  // Block random keyboard mash / gibberish emails (e.g. `gsgdgsgdgsgs@gmail.com`, `asdfghjkl@...`)
  if (isGibberishOrFakeLocalPart(localPart)) {
    throw badRequest(
      '⛔ البريد الإلكتروني المدخل يبدو عشوائياً أو غير حقيقي. يرجى كتابة بريدك الفعلي لتلقي رمز التحقق (OTP).',
      'fake_email',
    );
  }

  if (isDisposableOrFakeDomain(domain)) {
    throw badRequest(
      '⛔ يُمنع التسجيل بعناوين البريد الوهمية أو المؤقتة (Temp-Mail). يرجى استخدام بريد حقيقي مثل Gmail أو Outlook أو iCloud.',
      'disposable_email_blocked',
    );
  }

  if (opts.strictTrustedDomainsOnly && !TRUSTED_MAJOR_PROVIDERS.has(domain)) {
    throw badRequest(
      'يُسمح بالتسجيل فقط عبر مزودي البريد الموثوقين (Gmail, Outlook, Hotmail, iCloud, Yahoo, Proton).',
      'untrusted_email_provider',
    );
  }

  if (!opts.skipDnsMxCheck && !TRUSTED_MAJOR_PROVIDERS.has(domain)) {
    await verifyDomainHasRealMx(domain);
  }

  return {
    email,
    canonicalEmail: canonicalizeEmail(email),
    domain,
  };
}

async function verifyDomainHasRealMx(domain: string): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4500);
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
    const res = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: ac.signal,
    });
    if (!res.ok) return; // Fail open ONLY on DoH HTTP error so transient DNS hiccups don't break valid corporate domains
    const data = (await res.json()) as {
      Status?: number;
      Answer?: { type: number; data: string }[];
    };

    // Status 3 = NXDOMAIN (domain literally does not exist on the internet)
    if (data.Status === 3) {
      throw badRequest(
        `⛔ النطاق (@${domain}) غير موجود على الإنترنت! يرجى إدخال بريد إلكتروني حقيقي.`,
        'fake_email_domain',
      );
    }

    const mxAnswers = (data.Answer ?? []).filter((a) => a.type === 15 && typeof a.data === 'string');
    if (mxAnswers.length === 0) {
      throw badRequest(
        `⛔ النطاق (@${domain}) لا يملك خادم بريد إلكتروني حقيقي (MX). يرجى استخدام بريد حقيقي مثل Gmail أو Outlook.`,
        'no_mx_records',
      );
    }

    // Inspect MX target hostnames to catch custom domains pointing to temp-mail servers!
    for (const ans of mxAnswers) {
      const mxHost = ans.data.split(/\s+/).pop()?.replace(/\.$/, '').toLowerCase() ?? '';
      // Null MX (`0 .`) means domain explicitly accepts NO mail (RFC 7505)
      if (!mxHost) {
        throw badRequest(`⛔ النطاق (@${domain}) لا يستقبل رسائل البريد الإلكتروني.`, 'null_mx');
      }
      if (isDisposableOrFakeDomain(mxHost)) {
        throw badRequest(
          '⛔ هذا النطاق مرتبط بخدمة بريد مؤقت محظورة. يرجى استخدام بريد إلكتروني رسمي حقيقي.',
          'disposable_mx_blocked',
        );
      }
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    /* network timeout to DoH — let OTP verification itself act as final gate */
  } finally {
    clearTimeout(timer);
  }
}
