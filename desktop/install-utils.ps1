function Get-CondaPrefixFromOutput {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$OutputLines
    )

    $marker = '__POMODORO_ENV_PREFIX__='
    $markedPrefixes = @(
        $OutputLines |
            ForEach-Object { ([string]$_).Trim() } |
            Where-Object { $_.StartsWith($marker, [StringComparison]::Ordinal) } |
            ForEach-Object { $_.Substring($marker.Length).Trim() } |
            Where-Object { $_ }
    )
    if ($markedPrefixes.Count -eq 0) {
        throw 'Conda environment prefix query returned no marked output.'
    }

    return $markedPrefixes[-1]
}

function Get-PomodoroShortcutName {
    $nameCharacters = [char[]]@(
        [char]0x756A
        [char]0x8304
        [char]0x949F
    )

    return (-join $nameCharacters) + '.lnk'
}
