"""Generate BendControl-compatible backup filenames.

BendControl expects: B<yyMMddHHmm><name>.zip
Example: B2603171136backup31726.zip
"""

import re
from datetime import datetime


DEFAULT_NAME = "bendgen"
MAX_NAME_LEN = 30
_UNSAFE = re.compile(r"[^A-Za-z0-9_-]")


def sanitize_backup_name(name: str) -> str:
    """Strip unsafe characters from a backup name portion.

    BendControl shows the <name> section of the filename in its restore
    list, so users want to pick meaningful names. We allow letters,
    digits, underscores and hyphens, and fall back to the default if
    nothing sensible is left.
    """
    if not name:
        return DEFAULT_NAME
    cleaned = _UNSAFE.sub("", name)[:MAX_NAME_LEN]
    return cleaned or DEFAULT_NAME


def make_backup_filename(name: str = DEFAULT_NAME) -> str:
    """Generate a filename matching BendControl's backup regex pattern."""
    now = datetime.now()
    date_part = now.strftime("%y%m%d%H%M")
    return f"B{date_part}{sanitize_backup_name(name)}.zip"
