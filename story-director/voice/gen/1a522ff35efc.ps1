Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Huihui Desktop')
$s.Rate = 2
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('D:\xm\youxikaifangshijie\story-director\voice\gen\1a522ff35efc.wav', $fmt)
$s.Speak('你们好呀，我是阿风！')
$s.Dispose()