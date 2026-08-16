# Contributor License Agreement (CLA)

> 🌐 English (canonical) | [Türkçe](tr/cla.md)

---

> # ⚠️ DRAFT — PENDING LEGAL REVIEW, NOT IN FORCE
>
> **This document is an unreviewed draft.** It has **not** been reviewed or approved by a
> lawyer, it is **not** currently in effect, and nothing in it is legal advice. Do not rely on
> it. The placeholders marked `[FILL: …]` and `[ASK A LAWYER: …]` are unresolved and must be
> settled before this text becomes binding on anyone. Until this banner is removed in a
> merged, reviewed pull request, **no contributor is being asked to sign anything.**
>
> **This document is currently unused.** Kurul does not accept external contributions and
> the CLA check is disabled, so nobody signs this and no signature is collected. It is kept
> ready in case legal review ever happens — see
> [ADR 0015](decisions/0015-no-external-contributions.md).
>
> # ⚠️ TASLAK — HUKUKÇU ONAYI BEKLİYOR, YÜRÜRLÜKTE DEĞİL
>
> **Bu belge, incelenmemiş bir taslaktır.** Bir hukukçu tarafından incelenmemiş veya
> onaylanmamıştır, şu anda **yürürlükte değildir** ve içeriğinin hiçbir kısmı hukuki tavsiye
> değildir. Buna güvenmeyin. `[FILL: …]` ve `[ASK A LAWYER: …]` ile işaretlenmiş yer
> tutucular henüz çözülmemiştir ve bu metin herhangi biri için bağlayıcı hâle gelmeden önce
> karara bağlanmalıdır. Bu uyarı, incelenmiş ve merge edilmiş bir pull request ile
> kaldırılana kadar **hiçbir katkıda bulunandan bir şey imzalaması istenmemektedir.**
>
> **Bu belge şu anda kullanılmıyor.** Kurul dış katkı kabul etmiyor ve CLA kontrolü devre
> dışı; dolayısıyla bunu kimse imzalamıyor ve hiçbir imza toplanmıyor. Hukuki inceleme bir gün
> gerçekleşirse diye hazır tutuluyor — bkz.
> [ADR 0015](decisions/0015-no-external-contributions.md).

---

## Why Kurul asks for a CLA

Kurul is released under [AGPL-3.0](../LICENSE). The plan is to fund the project through
**dual licensing**: the same single codebase stays fully AGPL-3.0 for everyone, and
organizations that cannot live with AGPL's obligations can buy a separate commercial license
for the same code from the project owner.

That business model only works if the owner holds the right to distribute **all** of the code
— including your contribution — under a license other than AGPL-3.0. By default, you keep the
copyright in the code you write, and nobody else may relicense it. A CLA is the mechanism by
which you grant that permission, deliberately and in writing, while keeping ownership of your
own work.

We would rather say this plainly than dress it up: **you are being asked to grant the project
owner the right to also sell your contribution under a commercial license.** In exchange, the
agreement guarantees that your contribution stays available under AGPL-3.0 too (Section 2.3),
and that you keep every right to your own code that you had before signing (Section 2.1(a)) —
you can reuse it, relicense it, or publish it elsewhere, exactly as if you had never signed.

The reasoning behind the model — and its honest downsides — is recorded in
[ADR 0014](decisions/0014-dual-licensing-cla.md).

## How to sign

Signing happens inside the pull request. No email, no PDF, no scanner.

1. Open a pull request as usual.
2. The **CLA** check runs and, if you have not signed yet, a bot posts a comment on your PR
   linking to this document.
3. Read this document. If you agree, post a **new comment** on the pull request containing
   exactly:

   ```text
   I have read the Kurul CLA v0.1 and I hereby sign it
   ```

4. The check re-runs and turns green. Your signature is recorded in
   `signatures/v0.1/cla.json` on the repository's `cla-signatures` branch — a public,
   append-only record of who granted these rights.

You sign **once** per CLA version. Every later pull request from the same GitHub account is
covered automatically. If a check goes stale, comment `recheck` to re-run it.

### Versioning of this text

The version number is deliberately part of both the signing sentence and the storage path.
When the reviewed text lands, it becomes **v1.0**, the sentence becomes
`I have read the Kurul CLA v1.0 and I hereby sign it`, and signatures move to
`signatures/v1.0/cla.json`. A signature given against one version therefore can never be
counted as a signature against another — if the text is amended, it is always unambiguous
which wording each contributor actually agreed to, and who has yet to re-sign.

### What the signature record contains

The intended minimum for each signature is: **GitHub username, email address, date, the CLA
version signed, and the pull request it was given in.**

What the automation actually stores today is narrower — GitHub username, numeric user id,
the id of the signing comment, a timestamp, the repository id, and the pull request number.
The CLA version comes from the file path and signing sentence, as above. **Email address is
not captured**: the signing bot records the commenting account, not an address, and the
comment body is discarded before storage. The contributor's commit-author email is present in
the pull request's own git history, which the record points to by PR number, but it is not
copied into the ledger.

> `[ASK A LAWYER: Is an identifier-only record (GitHub account + PR reference) enough to evidence who signed, or must the ledger itself carry a name and email address? If it must, the record has to be collected out of band and the ledger moved to a private repository, because the tooling cannot capture it — see ADR 0014.]`

## What happens if you do not sign

The **CLA** check stays red and the pull request cannot be merged. That is the whole
consequence — no issue is closed, nothing is deleted, and you are welcome to keep filing
issues, reviewing, and discussing. If you would rather not sign, say so on the issue: a
maintainer can often reimplement a small fix independently, and bug reports with a clear
reproduction are valuable without any code attached.

Maintainers of the project are on an allowlist and are not prompted for a signature on their
own pull requests.

## Corporate and entity contributions

This document is the **individual** agreement. It is signed by you, personally.

If you are contributing **as part of your job**, your employer may own the copyright in your
work by default, in which case you cannot grant the rights in Section 2 on your own.
Section 3(c) requires you to have your employer's approval before signing.

A separate **Entity CLA** (a corporate agreement signed by someone authorized to bind the
company, listing the employees covered) is the normal way to handle this. Kurul does
**not** have one yet.

> `[ASK A LAWYER: Do we need a separate Entity CLA (Harmony HA-CLA-E) now, or is the employer-approval representation in Section 3(c) of the individual agreement enough until a corporate contributor actually appears? If we need one, what is the signing and verification process — and how does the PR-comment signing flow map onto a document that must be signed by an authorized officer rather than by the developer opening the PR?]`

Until that is settled: if you are contributing on company time or on company equipment,
**say so on the pull request** before signing, so a maintainer can flag it rather than
discover it later.

---

# Kurul Individual Contributor License Agreement

**Draft version:** 0.1 (unreviewed) · **Status:** Not in force

Derived from the **Harmony Individual Contributor License Agreement (HA-CLA-I-ANY) Version
1.0**, <https://www.harmonyagreements.org>, using the "any license" outbound option. The
Harmony templates are designed for exactly this situation — a project owner who intends to
distribute contributions under more than one license — which is why they are the base here
rather than the Apache Individual CLA, whose outbound grant assumes a single, permissive
outbound license.

Thank you for your interest in contributing to Kurul, a software project managed by **Doğan
Can Yıldız**, a natural person, of `[FILL: full address of the individual identified as "Us"]`
("We" or "Us").

The rights under this Agreement are granted to an **individual**, not to a company. "Dravcore"
is the name under which the project is published; it is not a legal entity and no company
currently exists to hold these rights.

This contributor agreement ("Agreement") documents the rights granted by contributors to Us.
To make this document effective, please sign it by following the instructions in
[How to sign](#how-to-sign) above. This is a legally binding document, so please read it
carefully before agreeing to it. The Agreement may cover more than one software project
managed by Us.

### This is a license, not an assignment — and that is deliberate

This Agreement is a **license grant**, not a transfer of ownership. You do not assign your
copyright to Us. You keep it (Section 2.1(a)) and grant Us a non-exclusive, worldwide,
perpetual, irrevocable, royalty-free, **sublicensable** license that includes the right to
distribute your Contribution **under any license terms** (Section 2.3).

This follows the Harmony Contributor **License** Agreement rather than the Harmony Contributor
**Assignment** Agreement, and the choice is intentional. Dual licensing does not require
owning the copyright — a broad, sublicensable license is sufficient to grant a paying customer
a commercial license to the whole codebase. Choosing the license form also avoids the stricter
formalities that several jurisdictions attach specifically to an **assignment** of economic
rights. Turkish law (FSEK) is the relevant example: it requires a written instrument
enumerating each economic right being transferred, and a comment posted on a pull request is
not a qualified electronic signature.

> `[ASK A LAWYER: Does structuring this as a license grant rather than an assignment actually escape FSEK's written-form requirement, or does FSEK impose the same written-form and right-enumeration requirement on licenses too? If the requirement applies either way, what additional step is needed for contributors resident in Türkiye — and does the answer differ for the owner, who is Turkish-resident, granting sublicenses onward?]`

### If a company is formed later

Kurul may one day be published by an incorporated entity. When that happens the rights
granted here do **not** move to the company automatically: they were granted to an individual,
and moving them is a **separate transfer transaction** between that individual and the new
company. Section 6.3 is the clause intended to make such a transfer possible without asking
every contributor to sign again.

> `[ASK A LAWYER: Is the assignability wording in Section 6.3 sufficient for the owner, as a natural person, to transfer the entire bundle of contributor licenses (including the right to sublicense) to a company he later incorporates — without re-signature from each contributor? If not, add an explicit assignability clause naming successors, affiliates, and acquirers, and state whether contributor notice or consent is required. Also confirm what form the individual-to-company transfer itself must take under FSEK.]`

## 1. Definitions

**"You"** means the individual who Submits a Contribution to Us.

**"Contribution"** means any work of authorship that is Submitted by You to Us in which You
own or assert ownership of the Copyright. If You do not own the Copyright in the entire work
of authorship, please follow the instructions in
[Corporate and entity contributions](#corporate-and-entity-contributions) above.

**"Copyright"** means all rights protecting works of authorship owned or controlled by You,
including copyright, moral and neighboring rights, as appropriate, for the full term of their
existence including any extensions by You.

**"Material"** means the work of authorship which is made available by Us to third parties.
When this Agreement covers more than one software project, the Material means the work of
authorship to which the Contribution was Submitted. After You Submit the Contribution, it may
be included in the Material.

**"Submit"** means any form of electronic, verbal, or written communication sent to Us or our
representatives, including but not limited to electronic mailing lists, source code control
systems, and issue tracking systems that are managed by, or on behalf of, Us for the purpose
of discussing and improving the Material, but excluding communication that is conspicuously
marked or otherwise designated in writing by You as "Not a Contribution."

**"Submission Date"** means the date on which You Submit a Contribution to Us.

**"Effective Date"** means the date You execute this Agreement or the date You first Submit a
Contribution to Us, whichever is earlier.

> `[ASK A LAWYER: The Harmony template also defines "Media" (the non-software portion of a Contribution) for use with an optional clause licensing documentation and design assets under different terms. That definition and clause are omitted here. Kurul actively accepts documentation, Turkish translations, and design assets, so this is not hypothetical — do we need the Media clause, and if so under which outbound terms?]`

## 2. Grant of Rights

### 2.1 Copyright License

(a) **You retain ownership of the Copyright in Your Contribution and have the same rights to
use or license the Contribution which You would have had without entering into the
Agreement.**

(b) To the maximum extent permitted by the relevant law, You grant to Us a perpetual,
worldwide, non-exclusive, transferable, royalty-free, irrevocable license under the Copyright
covering the Contribution, with the right to sublicense such rights through multiple tiers of
sublicensees, to reproduce, modify, display, perform and distribute the Contribution as part
of the Material; provided that this license is conditioned upon compliance with Section 2.3.

### 2.2 Patent License

For patent claims including, without limitation, method, process, and apparatus claims which
You own, control or have the right to grant, now or in the future, You grant to Us a
perpetual, worldwide, non-exclusive, transferable, royalty-free, irrevocable patent license,
with the right to sublicense these rights to multiple tiers of sublicensees, to make, have
made, use, sell, offer for sale, import and otherwise transfer the Contribution and the
Contribution in combination with the Material (and portions of such combination). This license
is granted only to the extent that the exercise of the licensed rights infringes such patent
claims; and provided that this license is conditioned upon compliance with Section 2.3.

### 2.3 Outbound License

Based on the grant of rights in Sections 2.1 and 2.2, if We include Your Contribution in a
Material, **We may license the Contribution under any license, including copyleft, permissive,
commercial, or proprietary licenses.** As a condition on the exercise of this right, We agree
to also license the Contribution under the terms of the license or licenses which We are using
for the Material on the Submission Date.

For the avoidance of doubt: the license We are using for the Material on the Submission Date
is **GNU Affero General Public License version 3.0 (AGPL-3.0)**, as recorded in
[LICENSE](../LICENSE). Your Contribution therefore remains available to the public under
AGPL-3.0 regardless of any other license We grant.

### 2.4 Moral Rights

If moral rights apply to the Contribution, to the maximum extent permitted by law, You waive
and agree not to assert such moral rights against Us or our successors in interest, or any of
our licensees, either direct or indirect.

> `[ASK A LAWYER: Moral rights are not waivable in every jurisdiction. Under Turkish law (FSEK) moral rights are treated as personal to the author; whether — and in what form — this waiver is effective for a contributor or an owner subject to Turkish law needs to be confirmed, and the clause reworded if a bare waiver does not hold. Do not assume the Harmony wording transfers unchanged.]`

### 2.5 Our Rights

You acknowledge that We are not obligated to use Your Contribution as part of the Material and
may decide to include any Contribution We consider appropriate.

### 2.6 Reservation of Rights

Any rights not expressly licensed under this section are expressly reserved by You.

## 3. Agreement

You confirm that:

(a) You have the legal authority to enter into this Agreement.

(b) You own the Copyright and patent claims covering the Contribution which are required to
grant the rights under Section 2.

(c) The grant of rights under Section 2 does not violate any grant of rights which You have
made to third parties, including Your employer. If You are an employee, You have had Your
employer approve this Agreement or sign the Entity version of this document. If You are less
than eighteen years old, please have Your parents or guardian sign the Agreement.

(d) You have followed the instructions in
[Corporate and entity contributions](#corporate-and-entity-contributions), if You do not own
the Copyright in the entire work of authorship Submitted.

> `[ASK A LAWYER: Clause (c) requires a minor's parent or guardian to sign, but the PR-comment signing flow cannot verify age, identity, or guardianship — it records a GitHub username. Is a click-through signature by an unverified account enforceable at all, and does the minor case need a separate out-of-band process or an outright age restriction on contributing?]`

## 4. Disclaimer

EXCEPT FOR THE EXPRESS WARRANTIES IN SECTION 3, THE CONTRIBUTION IS PROVIDED "AS IS". MORE
PARTICULARLY, ALL EXPRESS OR IMPLIED WARRANTIES INCLUDING, WITHOUT LIMITATION, ANY IMPLIED
WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT ARE
EXPRESSLY DISCLAIMED BY YOU TO US. TO THE EXTENT THAT ANY SUCH WARRANTIES CANNOT BE
DISCLAIMED, SUCH WARRANTY IS LIMITED IN DURATION TO THE MINIMUM PERIOD PERMITTED BY LAW.

## 5. Consequential Damage Waiver

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL YOU BE LIABLE FOR ANY LOSS
OF PROFITS, LOSS OF ANTICIPATED SAVINGS, LOSS OF DATA, INDIRECT, SPECIAL, INCIDENTAL,
CONSEQUENTIAL AND EXEMPLARY DAMAGES ARISING OUT OF THIS AGREEMENT REGARDLESS OF THE LEGAL OR
EQUITABLE THEORY (CONTRACT, TORT OR OTHERWISE) UPON WHICH THE CLAIM IS BASED.

## 6. Miscellaneous

6.1 This Agreement will be governed by and construed in accordance with the laws of
`[FILL: governing jurisdiction]`, excluding its conflicts of law provisions. Under certain
circumstances, the governing law in this section might be superseded by the United Nations
Convention on Contracts for the International Sale of Goods ("UN Convention") and the parties
intend to avoid the application of the UN Convention to this Agreement and, thus, exclude the
application of the UN Convention in its entirety to this Agreement.

> `[ASK A LAWYER: Which law governs, and which courts have jurisdiction? "Us" is resident in Türkiye, but most contributors are expected to be outside it, so this choice affects both validity and enforceability. Turkish law with Turkish courts is simplest for the owner but is the hardest term for a foreign contributor to accept and the hardest to enforce against one abroad; a neutral or contributor-side choice reverses both. Is a separate forum-selection clause needed alongside the governing-law clause, and does a consumer- or employee-protection rule in the contributor's own country override either one regardless of what we write? Also confirm the UN Convention carve-out is meaningful here rather than boilerplate carried over from the template.]`

6.2 This Agreement sets out the entire agreement between You and Us for Your Contributions to
Us and overrides all other agreements or understandings.

6.3 If You or We assign the rights or obligations received through this Agreement to a third
party, as a condition of the assignment, that third party must agree in writing to abide by
all the rights and obligations in the Agreement.

6.4 The failure of either party to require performance by the other party of any provision of
this Agreement in one situation shall not affect the right of a party to require such
performance at any time in the future. A waiver of performance under a provision in one
situation shall not be considered a waiver of the performance of the provision in the future
or a waiver of the provision in its entirety.

6.5 If any provision of this Agreement is found void and unenforceable, such provision will be
replaced to the extent possible with a provision that comes closest to the meaning of the
original provision and which is enforceable. The terms and conditions set forth in this
Agreement shall apply notwithstanding any failure of essential purpose of this Agreement or
any limited remedy to the maximum extent possible under law.

## Signature

**You** — recorded as the GitHub account that posts the signing comment described in
[How to sign](#how-to-sign), together with the timestamp and pull request in which it was
posted.

**Us** — Doğan Can Yıldız, `[FILL: full address]`

---

## Questions for a lawyer

Concrete, document-specific items the project owner needs answered before this draft can go
into force. The inline `[ASK A LAWYER: …]` markers above are repeated here so the whole list
can be handed over at once.

### Who "Us" is, and what happens when that changes

1. **Address for the individual.** The preamble and signature block need Doğan Can Yıldız's
   full address. Is a residential address required, or is a business/correspondence address
   acceptable given the document is published on a public repository?
2. **Transfer to a future company** — see the inline marker under
   [If a company is formed later](#if-a-company-is-formed-later). Does Section 6.3 let the
   owner move the whole bundle of contributor licenses to a company he later incorporates
   without re-signature, and what form must that individual-to-company transfer take?
3. **Death or incapacity of the individual.** Because "Us" is a natural person rather than an
   entity, what happens to the licenses — do they pass to heirs, and should the agreement say
   so explicitly?

### Enforceability of the signing mechanism

4. **Is a pull request comment a valid signature?** The whole flow rests on an unverified
   GitHub account posting a fixed sentence. Under the applicable law, does that form a binding
   contract — and is the `signatures/v0.1/cla.json` ledger sufficient evidence of it? If not,
   what is the minimum that would be (name and email in the record, a click-through with an
   explicit assent screen, a qualified e-signature)?
5. **What the record must contain** — see the inline marker under
   [What the signature record contains](#what-the-signature-record-contains). The intended
   minimum is username, email, date, CLA version, and PR reference; the tooling cannot capture
   email.
6. **Consideration / mutuality.** The contributor grants broad rights and receives, in return,
   only the Section 2.3 promise to keep publishing under AGPL-3.0. Is that sufficient
   consideration in the governing jurisdiction, or does the agreement need an explicit recital
   of what the contributor receives?
7. **Minors** (Section 3(c)) — see the inline marker. The flow cannot verify age or
   guardianship. Separate process, or an age restriction on contributing?

### Turkish-law specifics

8. **FSEK form requirements, license vs. assignment** — see the inline marker under
   [This is a license, not an assignment](#this-is-a-license-not-an-assignment--and-that-is-deliberate).
   This is the single most load-bearing question in the document: the whole draft is
   structured as a license rather than an assignment specifically to try to stay clear of
   FSEK's written-form and right-enumeration rules for transfers of economic rights. This
   draft makes **no claim** that the attempt succeeds.
9. **Future works.** The agreement covers contributions not yet written at signing time. Some
   jurisdictions restrict licenses over future works; confirm this holds under the governing
   law and under FSEK for Turkish-resident contributors.
10. **Moral rights** (Section 2.4) — see the inline marker. FSEK treats moral rights as
    personal to the author; confirm whether the waiver holds, and reword if it does not.
11. **Language.** English is the canonical text here and Turkish is a translation. If a
    Turkish court is the forum, does the Turkish version need to be the binding one, and
    should the document state which language controls in the event of a discrepancy? The draft
    currently does not.

### Scope of the grant

12. **"Any license" outbound** (Section 2.3). Confirm this is broad enough to support selling
    a commercial, AGPL-obligation-free license to the whole codebase, including contributed
    parts — that is the entire point of the model, and if the clause falls short the model
    does not work. Confirm specifically that the **sublicensing** right reaches a customer of
    the owner, not just the owner.
13. **Patent license** (Section 2.2) — is the "have made … sell … import" grant appropriate
    for a project with no patents, or is it scope the project does not need and that
    contributors may balk at?
14. **Governing law and forum** (Section 6.1) — see the inline marker.
15. **Entity CLA** — see the inline marker under
    [Corporate and entity contributions](#corporate-and-entity-contributions).
16. **Media / non-software contributions** — see the inline marker under
    [Definitions](#1-definitions). Docs and Turkish translations are real contributions here.

### Operational

17. **Retroactivity.** Contributions merged before this CLA goes into force are not covered.
    Should past contributors be asked to sign retroactively, and what is the standing of the
    codebase until they do? (At the time of writing there are no external contributions —
    which is exactly why this is being set up now.)
18. **Versioning.** If the CLA text is amended later, do existing signatures carry over, or
    must contributors re-sign against the new version? The signing sentence and the signature
    file path both carry the version so that each signature is pinned to one wording, but the
    legal answer drives whether a re-signature campaign is required at all.
19. **Data protection.** The public signature ledger records a GitHub username and id — data
    already public on the pull request. If a lawyer requires legal names or email addresses in
    the ledger instead, storage has to move to a private repository; see
    [ADR 0014](decisions/0014-dual-licensing-cla.md). Does a public ledger of who signed
    require a KVKK/GDPR basis and a retention statement of its own?
