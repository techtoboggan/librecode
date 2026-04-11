import { ar, br, bs, da, de, en, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht } from "@librecode/i18n/app"

const numbered = Array.from(
  new Set([
    en["terminal.title.numbered"],
    ar["terminal.title.numbered"],
    br["terminal.title.numbered"],
    bs["terminal.title.numbered"],
    da["terminal.title.numbered"],
    de["terminal.title.numbered"],
    es["terminal.title.numbered"],
    fr["terminal.title.numbered"],
    ja["terminal.title.numbered"],
    ko["terminal.title.numbered"],
    no["terminal.title.numbered"],
    pl["terminal.title.numbered"],
    ru["terminal.title.numbered"],
    th["terminal.title.numbered"],
    tr["terminal.title.numbered"],
    zh["terminal.title.numbered"],
    zht["terminal.title.numbered"],
  ]),
)

export function defaultTitle(number: number) {
  return en["terminal.title.numbered"].replace("{{number}}", String(number))
}

export function isDefaultTitle(title: string, number: number) {
  return numbered.some((text) => title === text.replace("{{number}}", String(number)))
}

export function titleNumber(title: string, max: number) {
  return Array.from({ length: max }, (_, idx) => idx + 1).find((number) => isDefaultTitle(title, number))
}
