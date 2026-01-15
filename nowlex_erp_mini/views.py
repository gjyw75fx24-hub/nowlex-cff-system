from django.contrib.admin.models import LogEntry
from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse
from django.urls import reverse


@staff_member_required
def minhas_acoes(request):
    entries = (
        LogEntry.objects
        .select_related('content_type', 'user')
        .filter(user=request.user)
        .order_by('-action_time')[:20]
    )
    items = []
    for entry in entries:
        content_type = entry.content_type
        change_url = ''
        if content_type and entry.object_id:
            try:
                change_url = reverse(
                    f'admin:{content_type.app_label}_{content_type.model}_change',
                    args=[entry.object_id],
                )
            except Exception:
                change_url = ''
        items.append({
            'id': entry.id,
            'object_repr': entry.object_repr,
            'content_type': content_type.name if content_type else '',
            'action_flag': entry.action_flag,
            'action_time': entry.action_time.isoformat(),
            'action_time_display': entry.action_time.strftime('%d/%m/%Y %H:%M'),
            'change_message': entry.get_change_message() if hasattr(entry, 'get_change_message') else '',
            'change_url': change_url,
        })
    return JsonResponse({'items': items})
