import { Clock3 } from 'lucide-react'

export default function HistoryButton({ enabled = false, onOpen }) {
  return (
    <button type="button" onClick={onOpen}
      aria-label="打开本地历史记录"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700">
      <Clock3 className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">历史记录</span>
      {enabled && <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-label="本地历史已开启" />}
    </button>
  )
}
