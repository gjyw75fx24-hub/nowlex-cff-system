from django.contrib.auth.models import Group

SUPERVISOR_GROUP_NAME = "Supervisor"


def ensure_supervisor_group():
    group, _ = Group.objects.get_or_create(name=SUPERVISOR_GROUP_NAME)
    return group


def is_user_supervisor(user):
    if not user or not getattr(user, 'pk', None):
        return False
    return user.groups.filter(name=SUPERVISOR_GROUP_NAME).exists()
