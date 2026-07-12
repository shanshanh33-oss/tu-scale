import { useMemo, useState } from 'react'
import { CheckCircle, Copy, HeartHandshake, Lightbulb, Mail, MessageSquare, Send, Wrench } from 'lucide-react'
import RewardButton from './RewardButton'

const FEEDBACK_TYPES = [
  { id: 'feature', label: '功能建议', icon: Lightbulb },
  { id: 'bug', label: '问题反馈', icon: Wrench },
  { id: 'format', label: '格式支持', icon: MessageSquare },
  { id: 'business', label: '商务合作', icon: HeartHandshake },
]

const CONTACT_EMAIL = '994815006@qq.com'

const CONTACT_FAQ = [
  ['反馈会自动发送吗？', '不会。浏览器不能替你直接发邮件，可以复制反馈内容，或尝试打开本机邮件 App 后发送。'],
  ['需要留下联系方式吗？', '不强制。普通建议可以不填；如果希望我回复或讨论合作，再留下邮箱、微信或其他联系方式。'],
  ['可以提哪些需求？', '可以提图片压缩、批量尺寸、裁切比例、抠图换背景、更多格式支持、处理失败等问题。'],
  ['商务或批量处理怎么联系？', '选择“商务合作”，写清楚图片数量、平台要求、交付格式和时间，我会按需求判断是否适合做定制。'],
]

export default function ContactPage({ navigate }) {
  const [type, setType] = useState('feature')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [copied, setCopied] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)
  const [mailNotice, setMailNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitNotice, setSubmitNotice] = useState('')

  const feedbackText = useMemo(() => {
    const label = FEEDBACK_TYPES.find(item => item.id === type)?.label || '反馈'
    return [
      `反馈类型：${label}`,
      `联系方式：${contact || '未填写'}`,
      '',
      '反馈内容：',
      message || '请在这里填写你的建议、问题或合作需求。',
      '',
      '页面：TU Scale',
      `时间：${new Date().toLocaleString('zh-CN')}`,
    ].join('\n')
  }, [type, message, contact])

  const copyFeedback = async () => {
    await navigator.clipboard.writeText(feedbackText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const copyEmail = async () => {
    await navigator.clipboard.writeText(CONTACT_EMAIL)
    setEmailCopied(true)
    setTimeout(() => setEmailCopied(false), 1800)
  }

  const submitFeedback = async () => {
    if (message.trim().length < 3) {
      setSubmitNotice('请先写一点反馈内容。')
      return
    }

    setSubmitting(true)
    setSubmitNotice('')
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          message,
          contact,
          page: window.location.href,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok && result.ok) {
        setSubmitNotice('已提交，感谢你的反馈。')
        setMessage('')
        return
      }
      if (result.error === 'KV_NOT_CONFIGURED') {
        setSubmitNotice('表单接口已连通，但线上还没有配置存储。请先复制内容发到邮箱。')
        return
      }
      setSubmitNotice('提交失败，请稍后再试，或复制内容发到邮箱。')
    } catch {
      setSubmitNotice('提交失败，请检查网络，或复制内容发到邮箱。')
    } finally {
      setSubmitting(false)
    }
  }

  const openMail = () => {
    const subject = encodeURIComponent('TU Scale 反馈')
    const body = encodeURIComponent(feedbackText)
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`
    setMailNotice('如果没有反应，说明当前浏览器没有绑定邮件 App。请复制邮箱和反馈内容后手动发送。')
  }

  return (
    <div className="min-h-screen bg-gray-50/80">
      <ToolHeader active="contact" navigate={navigate} />
      <main className="max-w-5xl mx-auto px-4 py-6 pb-20 space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">反馈与联系</h1>
              <p className="text-sm text-gray-500 mt-1">告诉我你想要什么功能、哪里不好用，或者是否需要批量图片处理合作。</p>
            </div>
            <button onClick={copyEmail}
              className="inline-flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 hover:bg-indigo-100">
              {emailCopied ? <CheckCircle className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
              {emailCopied ? '邮箱已复制' : CONTACT_EMAIL}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {FEEDBACK_TYPES.map(item => {
              const Icon = item.icon
              return (
                <button key={item.id} onClick={() => setType(item.id)}
                  className={`text-left border rounded-xl p-3 transition-colors ${type === item.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:bg-indigo-50/40'}`}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Icon className="w-4 h-4 text-indigo-500" />
                    {item.label}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-800">你的反馈</span>
                <textarea value={message} onChange={(event) => setMessage(event.target.value)}
                  rows={9}
                  placeholder={type === 'business'
                    ? '请写明图片数量、使用平台、目标尺寸/格式、是否需要抠图，以及期望交付时间...'
                    : '例如：希望增加批量压缩到 2MB 以下、支持 PSD 预览导出、增加抠图换背景、某个浏览器转换失败...'}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 resize-y" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-gray-800">联系方式（选填）</span>
                <input value={contact} onChange={(event) => setContact(event.target.value)}
                  placeholder="邮箱、微信或其他联系方式。也可以不填。"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10" />
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={submitFeedback} disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">
                  {submitting ? <Send className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
                  {submitting ? '提交中' : '提交反馈'}
                </button>
                <button onClick={copyFeedback}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-semibold">
                  {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? '已复制' : '复制反馈内容'}
                </button>
                <button onClick={openMail}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50">
                  <Send className="w-4 h-4" /> 尝试打开邮件 App
                </button>
              </div>
              {submitNotice && <p className="text-xs leading-6 text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">{submitNotice}</p>}
              {mailNotice && <p className="text-xs leading-6 text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{mailNotice}</p>}
              <p className="text-xs leading-6 text-gray-500">提交内容会用于改进功能和判断付费需求；也可以复制内容后手动发邮件。</p>
            </div>

            <aside className="border border-gray-200 rounded-xl bg-gray-50 p-4 space-y-3">
              <h2 className="text-sm font-semibold text-gray-900">我最想知道这些</h2>
              <ul className="space-y-2 text-xs leading-6 text-gray-600">
                <li>你是做自媒体、网站配图，还是临时处理图片？</li>
                <li>哪个格式、尺寸或平台预设最常用？</li>
                <li>批量压缩、裁切比例或证件照预设哪里不够顺手？</li>
                <li>你愿意为什么高级功能付费？批量、抠图、换背景，还是更强 AI？</li>
              </ul>
              <div className="border-t border-gray-200 pt-3">
                <p className="text-xs leading-6 text-gray-500">如果你只是想支持维护，也可以继续使用右下角的赞赏入口。产品建议比赞赏还珍贵一点点。</p>
              </div>
            </aside>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <InfoCard title="功能建议" text="告诉我你希望增加哪些图片工具，比如压缩、裁剪、抠图、换背景或格式支持。" />
          <InfoCard title="问题报告" text="如果某种图片无法读取、转换失败、下载失败，可以描述浏览器和图片格式。" />
          <InfoCard title="合作需求" text="如果你有批量图片处理、固定尺寸导出或定制工具需求，可以先留下联系方式。" />
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">常见问题</h2>
            <p className="text-xs text-gray-500 mt-1">关于反馈、隐私和合作沟通。</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CONTACT_FAQ.map(([question, answer]) => (
              <InfoCard key={question} title={question} text={answer} />
            ))}
          </div>
        </section>
      </main>
      <RewardButton />
    </div>
  )
}

function InfoCard({ title, text }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs leading-6 text-gray-500 mt-1">{text}</p>
    </div>
  )
}

function ToolHeader({ active, navigate }) {
  const items = [
    { id: 'upscale', label: '图片放大', path: '/' },
    { id: 'converter', label: '图片压缩', path: '/format-converter' },
    { id: 'product-image', label: '商品图规范化', path: '/product-image' },
    { id: 'contact', label: '反馈联系', path: '/contact' },
  ]

  return (
    <header className="bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 sm:px-6 py-3 sticky top-0 z-10 shadow-sm">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3 sm:gap-4">
        <img src="/logo.png" alt="TU Scale" className="h-16 sm:h-18 w-auto shrink-0" />
        <div className="flex flex-col min-w-0 mr-auto justify-center">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate leading-tight" style={{ color: '#8040f0' }}>TU Scale</h1>
        </div>
        <nav className="order-2 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {items.map(item => (
            <button key={item.id} onClick={() => navigate(item.path)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${active === item.id ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-gray-500 hover:bg-gray-50 border border-transparent'}`}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
