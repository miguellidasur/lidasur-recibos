USE [LidasurRecibos];
GO

-- Acepta el hash como texto hex (ej: 'E7A3...') y lo convierte a VARBINARY.
CREATE OR ALTER PROCEDURE hr.sp_PaySlips_Add
    @UserId       INT,
    @PeriodYear   INT,
    @PeriodMonth  INT,
    @Fortnight    TINYINT = NULL,
    @FileName     NVARCHAR(260),
    @StoragePath  NVARCHAR(400),
    @FileHashHex  NVARCHAR(128) = NULL,    -- <— antes seguramente era VARBINARY
    @FileSizeBytes BIGINT,
    @Note         NVARCHAR(255) = NULL,
    @ActorUserId  INT,
    @NewId        INT OUTPUT,
    @NewVersion   INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    -- Convertimos el hex textual a varbinary (estilo 2 = hex sin 0x)
    DECLARE @FileHash VARBINARY(64) = 
        CASE 
            WHEN @FileHashHex IS NULL OR LTRIM(RTRIM(@FileHashHex)) = '' THEN NULL
            ELSE CONVERT(VARBINARY(64), @FileHashHex, 2)
        END;

    -- Versión: si ya existe recibo mismo período, se incrementa
    DECLARE @Version INT =
    (
        SELECT ISNULL(MAX(Version), 0) + 1
        FROM hr.PaySlips
        WHERE UserId = @UserId
          AND PeriodYear  = @PeriodYear
          AND PeriodMonth = @PeriodMonth
          AND ISNULL(Fortnight, 0) = ISNULL(@Fortnight, 0)
    );

    INSERT INTO hr.PaySlips
        (UserId, PeriodYear, PeriodMonth, Fortnight,
         FileName, StoragePath, FileHash, FileSizeBytes,
         Version, Note, UploadedBy)
    VALUES
        (@UserId, @PeriodYear, @PeriodMonth, @Fortnight,
         @FileName, @StoragePath, @FileHash, @FileSizeBytes,
         @Version, @Note, @ActorUserId);

    SET @NewId = SCOPE_IDENTITY();
    SET @NewVersion = @Version;

    -- Audit opcional
    INSERT INTO hr.AuditLogs (ActorUserId, Action, TargetId)
    VALUES (@ActorUserId, N'UPLOAD', @NewId);
END
GO

DECLARE @EMP INT = (SELECT TOP 1 Id FROM hr.Users ORDER BY Id);
DECLARE @NewId INT, @NewVer INT;

EXEC hr.sp_PaySlips_Add
     @UserId        = @EMP,
     @PeriodYear    = 2025,
     @PeriodMonth   = 11,
     @Fortnight     = 2,
     @FileName      = N'00000000_PEREZ_JUAN.pdf',
     @StoragePath   = N'\\srv\recibos\00000000\2025\11\2\',
     @FileHashHex   = 'E7A3D4F1C2B5AB8D9F0A11223344556677889900AABBCCDDEEFF001122334455', -- ejemplo hex
     @FileSizeBytes = 123456,
     @Note          = N'Prueba CONVERT',
     @ActorUserId   = @EMP,      -- si querés usar el mismo como actor
     @NewId         = @NewId OUTPUT,
     @NewVersion    = @NewVer OUTPUT;

SELECT NewId=@NewId, NewVersion=@NewVer;

SELECT TOP 5 *
FROM hr.vw_PaySlips_ByUser
WHERE UserId = @EMP
ORDER BY PeriodYear DESC, PeriodMonth DESC, ISNULL(Fortnight,0) DESC, Version DESC, Id DESC;
