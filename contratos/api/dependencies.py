# =============================================================================
# STEP 3: Required Dependencies for Escavador API Integration
# =============================================================================

"""
Add these packages to your requirements.txt or install via pip:
"""

REQUIRED_PACKAGES = [
    "requests>=2.31.0",  # For HTTP API calls
    "python-decouple>=3.8",  # For environment variable management
    "validators>=0.22.0",  # For data validation (optional)
]

# Command to install:
# pip install requests python-decouple validators

# Or add to requirements.txt:
REQUIREMENTS_TXT_ADDITION = """
# API Integration
requests>=2.31.0
python-decouple>=3.8
validators>=0.22.0
"""