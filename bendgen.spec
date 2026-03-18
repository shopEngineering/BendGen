# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for BendGen."""

a = Analysis(
    ['bendgen_app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('bendgen/templates', 'bendgen/templates'),
        ('bendgen/static', 'bendgen/static'),
    ],
    hiddenimports=[
        'bendgen',
        'bendgen.app',
        'bendgen.models',
        'bendgen.generator',
        'bendgen.merge',
        'bendgen.backup_name',
        'bendgen.stock_tooling',
        'bendgen.dxf_analyzer',
        'bendgen.image_analyzer',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='BendGen',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='BendGen',
)
