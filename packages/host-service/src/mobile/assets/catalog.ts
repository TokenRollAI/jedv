import {
	LOCALE_COOKIE,
	LOCALE_LABELS,
	SUPPORTED_LOCALES,
} from "@jedv/i18n/locales";
import { messages as catalog15 } from "@jedv/i18n/messages/cs";
import { messages as catalog7 } from "@jedv/i18n/messages/de";
import { messages as catalog0 } from "@jedv/i18n/messages/en";
import { messages as catalog6 } from "@jedv/i18n/messages/es";
import { messages as catalog3 } from "@jedv/i18n/messages/fr";
import { messages as catalog14 } from "@jedv/i18n/messages/id";
import { messages as catalog9 } from "@jedv/i18n/messages/it";
import { messages as catalog1 } from "@jedv/i18n/messages/ja";
import { messages as catalog4 } from "@jedv/i18n/messages/ko";
import { messages as catalog13 } from "@jedv/i18n/messages/nl";
import { messages as catalog12 } from "@jedv/i18n/messages/pl";
import { messages as catalog8 } from "@jedv/i18n/messages/pt-BR";
import { messages as catalog10 } from "@jedv/i18n/messages/ru";
import { messages as catalog11 } from "@jedv/i18n/messages/tr";
import { messages as catalog17 } from "@jedv/i18n/messages/uk";
import { messages as catalog16 } from "@jedv/i18n/messages/vi";
import { messages as catalog2 } from "@jedv/i18n/messages/zh-CN";
import { messages as catalog5 } from "@jedv/i18n/messages/zh-TW";
import { setupI18n } from "@lingui/core";
import { mobileMessages } from "./messages";

const catalogs = {
	en: catalog0,
	ja: catalog1,
	"zh-CN": catalog2,
	fr: catalog3,
	ko: catalog4,
	"zh-TW": catalog5,
	es: catalog6,
	de: catalog7,
	"pt-BR": catalog8,
	it: catalog9,
	ru: catalog10,
	tr: catalog11,
	pl: catalog12,
	nl: catalog13,
	id: catalog14,
	cs: catalog15,
	vi: catalog16,
	uk: catalog17,
};

export function mobileCatalogs() {
	const result: Record<string, Record<string, string>> = {};
	for (const locale of SUPPORTED_LOCALES) {
		const catalog = catalogs[locale];
		const selected: Record<string, (typeof catalog)[keyof typeof catalog]> = {};
		for (const descriptor of Object.values(mobileMessages)) {
			if (!descriptor.id || catalog[descriptor.id] === undefined)
				throw new Error(
					`Missing mobile translation in ${locale}: ${descriptor.id}`,
				);
			selected[descriptor.id] = catalog[descriptor.id] as NonNullable<
				(typeof catalog)[string]
			>;
		}
		const engine = setupI18n({ locale, messages: { [locale]: selected } });
		result[locale] = {};
		for (const [key, descriptor] of Object.entries(mobileMessages))
			result[locale][key] = engine._(descriptor.id ?? "", {
				time: "{time}",
				count: "{count}",
			});
	}
	return result;
}
export function mobileCatalogSource() {
	return `export const catalogs=${JSON.stringify(mobileCatalogs())};\nexport const localeLabels=${JSON.stringify(LOCALE_LABELS)};\nexport const supportedLocales=${JSON.stringify(SUPPORTED_LOCALES)};\nexport const localeCookie=${JSON.stringify(LOCALE_COOKIE)};`;
}
