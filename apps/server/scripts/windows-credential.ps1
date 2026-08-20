param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("probe", "get", "set", "delete")]
  [string]$Operation,

  [Parameter(Mandatory = $true, Position = 1)]
  [string]$TargetName
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class LlmHarnessCredentialManager
{
    public const uint CRED_TYPE_GENERIC = 1;
    public const uint CRED_PERSIST_LOCAL_MACHINE = 2;
    public const int ERROR_NOT_FOUND = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite([In] ref Credential credential, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = false)]
    public static extern void CredFree(IntPtr buffer);
}
"@

if ($Operation -eq "probe") {
  exit 0
}

if ($Operation -eq "set") {
  $secret = [Console]::In.ReadToEnd()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($secret)
  if ($bytes.Length -gt 2560) {
    throw "Credential exceeds the Windows Credential Manager blob limit"
  }
  $blob = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
    $credential = New-Object LlmHarnessCredentialManager+Credential
    $credential.Type = [LlmHarnessCredentialManager]::CRED_TYPE_GENERIC
    $credential.TargetName = $TargetName
    $credential.CredentialBlobSize = $bytes.Length
    $credential.CredentialBlob = $blob
    $credential.Persist = [LlmHarnessCredentialManager]::CRED_PERSIST_LOCAL_MACHINE
    $credential.UserName = "LLM Harness"
    if (-not [LlmHarnessCredentialManager]::CredWrite([ref]$credential, 0)) {
      throw "Credential Manager write failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
  }
  finally {
    if ($bytes.Length -gt 0) {
      [Array]::Clear($bytes, 0, $bytes.Length)
      for ($index = 0; $index -lt $bytes.Length; $index++) {
        [Runtime.InteropServices.Marshal]::WriteByte($blob, $index, 0)
      }
    }
    [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob)
  }
  exit 0
}

if ($Operation -eq "get") {
  $pointer = [IntPtr]::Zero
  if (-not [LlmHarnessCredentialManager]::CredRead(
    $TargetName,
    [LlmHarnessCredentialManager]::CRED_TYPE_GENERIC,
    0,
    [ref]$pointer
  )) {
    if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq [LlmHarnessCredentialManager]::ERROR_NOT_FOUND) {
      exit 2
    }
    throw "Credential Manager read failed"
  }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
      $pointer,
      [type][LlmHarnessCredentialManager+Credential]
    )
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy(
      $credential.CredentialBlob,
      $bytes,
      0,
      $credential.CredentialBlobSize
    )
    [Console]::Out.Write([Convert]::ToBase64String($bytes))
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
  finally {
    [LlmHarnessCredentialManager]::CredFree($pointer)
  }
  exit 0
}

if (-not [LlmHarnessCredentialManager]::CredDelete(
  $TargetName,
  [LlmHarnessCredentialManager]::CRED_TYPE_GENERIC,
  0
)) {
  if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne [LlmHarnessCredentialManager]::ERROR_NOT_FOUND) {
    throw "Credential Manager delete failed"
  }
}
