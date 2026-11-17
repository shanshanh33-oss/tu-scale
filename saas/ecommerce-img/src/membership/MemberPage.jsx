import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, Mail, Phone } from 'lucide-react'
import { getMemberErrorMessage, memberRequest } from './memberApi'

const LOCAL_PREVIEW = import.meta.env.DEV && import.meta.env.VITE_MEMBER_PREVIEW === '1'

export default function MemberPage({ navigate }) {
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState(LOCAL_PREVIEW ? 'demo@example.test' : '')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [phone, setPhone] = useState(LOCAL_PREVIEW ? '+8613800138000' : '')
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneCodeSent, setPhoneCodeSent] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    memberRequest('session').then(result => {
      if (active) setMember(result.member || null)
    }).catch(() => {
      if (active) setUnavailable(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const run = async (operation) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (err) {
      setError(getMemberErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const requestEmailCode = event => {
    event.preventDefault()
    void run(async () => {
      await memberRequest('emailStart', { email: email.trim() })
      setEmailCodeSent(true)
      setNotice('若邮箱可用，验证码已发送。请检查收件箱。')
    })
  }

  const verifyEmailCode = event => {
    event.preventDefault()
    void run(async () => {
      await memberRequest('emailVerify', { email: email.trim(), code: emailCode.trim() })
      const result = await memberRequest('session')
      if (!result.member) throw new Error('SESSION_NOT_READY')
      setMember(result.member)
      setEmailCode('')
      setNotice('邮箱已验证，会员账号已就绪。')
    })
  }

  const requestPhoneCode = event => {
    event.preventDefault()
    void run(async () => {
      await memberRequest('phoneStart', { phone: phone.trim() })
      setPhoneCodeSent(true)
      setNotice('若手机号可用，验证码已发送。')
    })
  }

  const verifyPhoneCode = event => {
    event.preventDefault()
    void run(async () => {
      await memberRequest('phoneVerify', { phone: phone.trim(), code: phoneCode.trim() })
      const result = await memberRequest('session')
      if (!result.member?.phoneMasked) throw new Error('SESSION_NOT_READY')
      setMember(result.member)
      setPhone('')
      setPhoneCode('')
      setPhoneCodeSent(false)
      setNotice('手机号已验证并绑定。')
    })
  }

  const logout = () => void run(async () => {
    await memberRequest('logout')
    setMember(null)
    setEmailCodeSent(false)
    setPhoneCodeSent(false)
    setNotice('已退出会员账号。')
  })

  const fillDemoCode = kind => void run(async () => {
    const response = await fetch(`/api/member-preview/code?kind=${kind}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('NO_DEMO_CODE')
    const { code } = await response.json()
    if (kind === 'email') setEmailCode(code)
    else setPhoneCode(code)
  })

  return <div className="min-h-screen bg-gray-50/80 text-gray-800">
    <header className="border-b border-gray-100 bg-white px-4 py-4">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <button type="button" onClick={() => navigate('/')} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label="返回图片放大">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <img src="/logo.png" alt="TU Scale" className="h-11 w-auto" />
        <strong className="text-lg text-indigo-700">会员中心</strong>
      </div>
    </header>
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">会员账号</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">邮箱验证码可用于注册或登录；登录后可验证并绑定手机号。现有免费图片工具继续无需登录，图片仍在浏览器本地处理。</p>
      </section>

      {LOCAL_PREVIEW && <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        本机会员演示：仅使用预填的测试邮箱和手机号。验证码不会发送到真实邮箱或手机；点击“填入演示验证码”即可继续。测试账号只保存在此服务的内存中，重启后清空。
      </div>}

      {loading && <div role="status" className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" />正在检查会员服务…</div>}
      {!loading && unavailable && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">会员服务尚未启用，当前无法注册或绑定联系方式。</div>}
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {!loading && !unavailable && !member && <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Mail className="h-5 w-5 text-indigo-600" />邮箱注册或登录</h2>
        <form onSubmit={requestEmailCode} className="mt-5 space-y-3">
          <label htmlFor="member-email" className="block text-sm font-medium">邮箱地址</label>
          <input id="member-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy || emailCodeSent}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{emailCodeSent ? '重新发送验证码' : '发送邮箱验证码'}</button>
        </form>
        {emailCodeSent && <form onSubmit={verifyEmailCode} className="mt-5 space-y-3 border-t border-gray-100 pt-5">
          <label htmlFor="member-email-code" className="block text-sm font-medium">邮箱验证码</label>
          <input id="member-email-code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={8} value={emailCode} onChange={event => setEmailCode(event.target.value)} disabled={busy}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">验证并进入会员中心</button>
          {LOCAL_PREVIEW && <button type="button" onClick={() => fillDemoCode('email')} disabled={busy} className="ml-3 rounded-lg border border-indigo-200 px-3 py-2.5 text-sm text-indigo-700 disabled:opacity-50">填入演示验证码</button>}
          <button type="button" onClick={() => { setEmailCodeSent(false); setEmailCode('') }} className="ml-3 text-sm text-gray-500 hover:text-indigo-700">更换邮箱</button>
        </form>}
      </section>}

      {!loading && !unavailable && member && <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold">账号信息</h2><p className="mt-2 text-sm text-gray-600">邮箱：{member.emailMasked || '未绑定'}</p><p className="mt-1 text-sm text-gray-600">手机号：{member.phoneMasked || '未绑定'}</p></div>
          <button type="button" onClick={logout} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 disabled:opacity-50">退出登录</button>
        </div>
        {!member.phoneMasked && <div className="mt-6 border-t border-gray-100 pt-5">
          <h3 className="flex items-center gap-2 font-semibold"><Phone className="h-5 w-5 text-indigo-600" />绑定手机号</h3>
          <form onSubmit={requestPhoneCode} className="mt-4 space-y-3">
            <label htmlFor="member-phone" className="block text-sm font-medium">手机号（含国家区号）</label>
            <input id="member-phone" type="tel" autoComplete="tel" required placeholder="+86 13800138000" value={phone} onChange={event => setPhone(event.target.value)} disabled={busy || phoneCodeSent}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{phoneCodeSent ? '重新发送验证码' : '发送短信验证码'}</button>
          </form>
          {phoneCodeSent && <form onSubmit={verifyPhoneCode} className="mt-5 space-y-3">
            <label htmlFor="member-phone-code" className="block text-sm font-medium">短信验证码</label>
            <input id="member-phone-code" type="text" inputMode="numeric" autoComplete="one-time-code" required maxLength={8} value={phoneCode} onChange={event => setPhoneCode(event.target.value)} disabled={busy}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">验证并绑定</button>
            {LOCAL_PREVIEW && <button type="button" onClick={() => fillDemoCode('phone')} disabled={busy} className="ml-3 rounded-lg border border-indigo-200 px-3 py-2.5 text-sm text-indigo-700 disabled:opacity-50">填入演示验证码</button>}
            <button type="button" onClick={() => { setPhoneCodeSent(false); setPhoneCode('') }} className="ml-3 text-sm text-gray-500 hover:text-indigo-700">更换手机号</button>
          </form>}
        </div>}
      </section>}
    </main>
  </div>
}
