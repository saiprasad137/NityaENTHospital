import {
  CreateAchievementBody,
  CreateAchievementResponse,
  CreateAppointmentBody,
  CreateAppointmentResponse,
  CreateDoctorBody,
  CreateDoctorResponse,
  CreateEventBody,
  CreateEventResponse,
  CreateMediaBody,
  CreateMediaResponse,
  GetAdminOverviewResponse,
  GetAdminSessionResponse,
  GetGoogleReviewsResponse,
  ListAdminAchievementsResponse,
  ListAdminAppointmentsResponse,
  ListAdminDoctorsResponse,
  ListAdminEventsResponse,
  ListAdminMediaResponse,
  ListPublicAchievementsResponse,
  ListPublicDoctorsResponse,
  ListPublicEventsResponse,
  ListPublicMediaResponse,
  UpdateAchievementBody,
  UpdateAchievementParams,
  UpdateAchievementResponse,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  UpdateAppointmentResponse,
  UpdateDoctorBody,
  UpdateDoctorParams,
  UpdateDoctorResponse,
  UpdateEventBody,
  UpdateEventParams,
  UpdateEventResponse,
  UpdateMediaBody,
  UpdateMediaParams,
  UpdateMediaResponse,
} from "@workspace/api-zod";
import { db, achievementsTable, appointmentsTable, doctorsTable, eventsTable, mediaTable } from "@workspace/db";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireAdmin, resolveAdminIdentity } from "../middlewares/adminAuth";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const GOOGLE_REVIEWS_URL =
  "https://www.google.com/search?q=nityaent&rlz=1C5CHFA_enIN1178IN1186&oq=nityaent&gs_lcrp=EgZjaHJvbWUyBggAEEUYOdIBCDQ1MDJqMGo5qAIAsAIB&sourceid=chrome&source=chrome.ob&ie=UTF-8#lrd=0x3bcdbfab383a2563:0xf65ac1e7628b66e7,1,,,,";
const GOOGLE_API_FIELDS =
  "places.id,places.displayName,places.rating,places.userRatingCount,places.reviews";

function mediaAssetUrl(objectPath: string): string {
  return `/api/storage${objectPath}`;
}

function withMediaUrl<T extends { objectPath: string }>(item: T) {
  return { ...item, assetUrl: mediaAssetUrl(item.objectPath) };
}

router.get("/public/doctors", async (req, res): Promise<void> => {
  const doctors = await db
    .select()
    .from(doctorsTable)
    .where(eq(doctorsTable.isActive, true))
    .orderBy(doctorsTable.name);
  res.json(ListPublicDoctorsResponse.parse(doctors));
});

router.get("/public/events", async (req, res): Promise<void> => {
  const events = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.isPublished, true),
        gte(eventsTable.startsAt, new Date()),
      ),
    )
    .orderBy(eventsTable.startsAt);
  res.json(ListPublicEventsResponse.parse(events));
});

router.get("/public/achievements", async (req, res): Promise<void> => {
  const achievements = await db
    .select()
    .from(achievementsTable)
    .where(eq(achievementsTable.isPublished, true))
    .orderBy(desc(achievementsTable.achievedYear));
  res.json(ListPublicAchievementsResponse.parse(achievements));
});

router.get("/public/media", async (req, res): Promise<void> => {
  const media = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.isPublished, true))
    .orderBy(mediaTable.sortOrder, desc(mediaTable.createdAt));
  res.json(ListPublicMediaResponse.parse(media.map(withMediaUrl)));
});

router.get("/public/reviews", async (req, res): Promise<void> => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.json(
      GetGoogleReviewsResponse.parse({
        reviews: [],
        averageRating: null,
        totalReviewCount: null,
        reviewsUrl: GOOGLE_REVIEWS_URL,
        sourceConfigured: false,
      }),
    );
    return;
  }

  try {
    const placeId = process.env.GOOGLE_PLACE_ID;
    const googleResponse = placeId
      ? await fetch(
          `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
          {
            headers: {
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask":
                "id,rating,userRatingCount,reviews",
            },
            signal: AbortSignal.timeout(8_000),
          },
        )
      : await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": GOOGLE_API_FIELDS,
          },
          body: JSON.stringify({
            textQuery: process.env.GOOGLE_PLACES_QUERY ?? "NityaENT",
          }),
          signal: AbortSignal.timeout(8_000),
        });

    if (!googleResponse.ok) {
      req.log.warn(
        { statusCode: googleResponse.status },
        "Google Places review request failed",
      );
      res.status(502).json({ error: "Google reviews could not be fetched." });
      return;
    }

    type GooglePlaceDetails = {
      displayName?: { text?: string };
      rating?: number;
      userRatingCount?: number;
      reviews?: Array<{
        rating?: number;
        text?: { text?: string };
        authorAttribution?: { displayName?: string };
        relativePublishTimeDescription?: string;
        publishTime?: string;
      }>;
    };
    const payload = (await googleResponse.json()) as GooglePlaceDetails & {
      places?: Array<GooglePlaceDetails>;
    };
    const place: GooglePlaceDetails = payload.places?.[0] ?? payload;
    if (
      !placeId &&
      !/nitya.*ent|ent.*nitya/i.test(place.displayName?.text ?? "")
    ) {
      res.json(
        GetGoogleReviewsResponse.parse({
          reviews: [],
          averageRating: null,
          totalReviewCount: null,
          reviewsUrl: GOOGLE_REVIEWS_URL,
          sourceConfigured: false,
        }),
      );
      return;
    }
    const reviews = (place.reviews ?? [])
      .filter((review) => review.authorAttribution?.displayName)
      .map((review) => ({
        authorName: review.authorAttribution?.displayName ?? "Google user",
        rating: review.rating ?? 0,
        text: review.text?.text ?? "",
        relativeTime: review.relativePublishTimeDescription ?? "",
        publishedAt: review.publishTime ?? null,
      }));

    res.json(
      GetGoogleReviewsResponse.parse({
        reviews,
        averageRating: place.rating ?? null,
        totalReviewCount: place.userRatingCount ?? null,
        reviewsUrl: GOOGLE_REVIEWS_URL,
        sourceConfigured: true,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not fetch Google reviews");
    res.status(502).json({ error: "Google reviews could not be fetched." });
  }
});

router.post("/appointments", async (req, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const input = parsed.data;
  const requestedDate = input.preferredDate.toISOString().slice(0, 10);
  const todayInIndia = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  if (requestedDate < todayInIndia) {
    res.status(400).json({ error: "Choose today or a future date." });
    return;
  }

  if (input.doctorId != null) {
    const [doctor] = await db
      .select({ id: doctorsTable.id })
      .from(doctorsTable)
      .where(
        and(
          eq(doctorsTable.id, input.doctorId),
          eq(doctorsTable.isActive, true),
        ),
      );
    if (!doctor) {
      res.status(400).json({ error: "That doctor is not currently available." });
      return;
    }

    const requestedDay = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "Asia/Kolkata",
    }).format(input.preferredDate);
    const [availability] = await db
      .select({ days: doctorsTable.availabilityDays })
      .from(doctorsTable)
      .where(
        and(
          eq(doctorsTable.id, input.doctorId),
          eq(doctorsTable.isActive, true),
        ),
      );
    if (!availability?.days.includes(requestedDay)) {
      res.status(400).json({
        error: "That doctor is not available on the selected day.",
      });
      return;
    }
  }

  const [appointment] = await db
    .insert(appointmentsTable)
    .values({
      patientName: input.patientName.trim(),
      patientPhone: input.patientPhone.trim(),
      patientEmail: input.patientEmail?.trim() || null,
      visitType: input.visitType,
      doctorId: input.doctorId ?? null,
      preferredDate: requestedDate,
      preferredSlot: input.preferredSlot,
    })
    .returning();

  if (!appointment) {
    res.status(500).json({ error: "The appointment request could not be saved." });
    return;
  }

  const [doctor] = appointment.doctorId
    ? await db
        .select({ name: doctorsTable.name })
        .from(doctorsTable)
        .where(eq(doctorsTable.id, appointment.doctorId))
    : [];
  res.status(201).json(
    CreateAppointmentResponse.parse({
    id: appointment.id,
    patientName: appointment.patientName,
    patientPhone: appointment.patientPhone,
    patientEmail: appointment.patientEmail,
    visitType: appointment.visitType,
    doctorId: appointment.doctorId,
    doctorName: doctor?.name ?? null,
    preferredDate: appointment.preferredDate,
    preferredSlot: appointment.preferredSlot,
    status: appointment.status,
    createdAt: appointment.createdAt,
    }),
  );
});

router.get("/admin/session", async (req, res): Promise<void> => {
  try {
    const { identity, signedIn } = await resolveAdminIdentity(req);
    const configuredAdmins = new Set(
      (process.env.NITYA_ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
    res.json(
      GetAdminSessionResponse.parse({
        authorized:
          signedIn &&
          identity !== null &&
          configuredAdmins.has(identity.email),
        email: identity?.email ?? null,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not read administrator session");
    res.status(500).json({ error: "Could not check admin access." });
  }
});

router.get("/admin/overview", requireAdmin, async (_req, res): Promise<void> => {
  const today = new Date();
  const [
    pendingRows,
    appointmentRows,
    doctorRows,
    eventRows,
    achievementRows,
    mediaRows,
  ] = await Promise.all([
    db
      .select({ total: count() })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.status, "pending")),
    db.select({ total: count() }).from(appointmentsTable),
    db
      .select({ total: count() })
      .from(doctorsTable)
      .where(eq(doctorsTable.isActive, true)),
    db
      .select({ total: count() })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.isPublished, true),
          gte(eventsTable.startsAt, today),
        ),
      ),
    db
      .select({ total: count() })
      .from(achievementsTable)
      .where(eq(achievementsTable.isPublished, true)),
    db
      .select({ total: count() })
      .from(mediaTable)
      .where(eq(mediaTable.isPublished, true)),
  ]);

  res.json(
    GetAdminOverviewResponse.parse({
      pendingAppointments: pendingRows[0]?.total ?? 0,
      totalAppointments: appointmentRows[0]?.total ?? 0,
      activeDoctors: doctorRows[0]?.total ?? 0,
      upcomingEvents: eventRows[0]?.total ?? 0,
      publishedAchievements: achievementRows[0]?.total ?? 0,
      publishedMedia: mediaRows[0]?.total ?? 0,
    }),
  );
});

router.get(
  "/admin/appointments",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const appointments = await db
      .select({
        id: appointmentsTable.id,
        patientName: appointmentsTable.patientName,
        patientPhone: appointmentsTable.patientPhone,
        patientEmail: appointmentsTable.patientEmail,
        visitType: appointmentsTable.visitType,
        doctorId: appointmentsTable.doctorId,
        doctorName: doctorsTable.name,
        preferredDate: appointmentsTable.preferredDate,
        preferredSlot: appointmentsTable.preferredSlot,
        status: appointmentsTable.status,
        createdAt: appointmentsTable.createdAt,
      })
      .from(appointmentsTable)
      .leftJoin(doctorsTable, eq(appointmentsTable.doctorId, doctorsTable.id))
      .orderBy(desc(appointmentsTable.createdAt));
    res.json(ListAdminAppointmentsResponse.parse(appointments));
  },
);

router.patch(
  "/admin/appointments/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateAppointmentParams.safeParse(req.params);
    const body = UpdateAppointmentBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Invalid request.",
      });
      return;
    }

    const [appointment] = await db
      .update(appointmentsTable)
      .set({ status: body.data.status })
      .where(eq(appointmentsTable.id, params.data.id))
      .returning();
    if (!appointment) {
      res.status(404).json({ error: "Appointment not found." });
      return;
    }
    const [doctor] = appointment.doctorId
      ? await db
          .select({ name: doctorsTable.name })
          .from(doctorsTable)
          .where(eq(doctorsTable.id, appointment.doctorId))
      : [];
    res.json(
      UpdateAppointmentResponse.parse({
        ...appointment,
        doctorName: doctor?.name ?? null,
      }),
    );
  },
);

router.get(
  "/admin/doctors",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const doctors = await db
      .select()
      .from(doctorsTable)
      .orderBy(doctorsTable.name);
    res.json(ListAdminDoctorsResponse.parse(doctors));
  },
);

router.post(
  "/admin/doctors",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateDoctorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [doctor] = await db
      .insert(doctorsTable)
      .values(parsed.data)
      .returning();
    res.status(201).json(CreateDoctorResponse.parse(doctor));
  },
);

router.patch(
  "/admin/doctors/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateDoctorParams.safeParse(req.params);
    const body = UpdateDoctorBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Invalid request.",
      });
      return;
    }
    const [doctor] = await db
      .update(doctorsTable)
      .set(body.data)
      .where(eq(doctorsTable.id, params.data.id))
      .returning();
    if (!doctor) {
      res.status(404).json({ error: "Doctor not found." });
      return;
    }
    res.json(UpdateDoctorResponse.parse(doctor));
  },
);

router.delete(
  "/admin/doctors/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateDoctorParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [doctor] = await db
      .delete(doctorsTable)
      .where(eq(doctorsTable.id, params.data.id))
      .returning();
    if (!doctor) {
      res.status(404).json({ error: "Doctor not found." });
      return;
    }
    res.sendStatus(204);
  },
);

router.get("/admin/events", requireAdmin, async (_req, res): Promise<void> => {
  const events = await db
    .select()
    .from(eventsTable)
    .orderBy(desc(eventsTable.startsAt));
  res.json(ListAdminEventsResponse.parse(events));
});

router.post("/admin/events", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [event] = await db
    .insert(eventsTable)
    .values(parsed.data)
    .returning();
  res.status(201).json(CreateEventResponse.parse(event));
});

router.patch(
  "/admin/events/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateEventParams.safeParse(req.params);
    const body = UpdateEventBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Invalid request.",
      });
      return;
    }
    const [event] = await db
      .update(eventsTable)
      .set(body.data)
      .where(eq(eventsTable.id, params.data.id))
      .returning();
    if (!event) {
      res.status(404).json({ error: "Event not found." });
      return;
    }
    res.json(UpdateEventResponse.parse(event));
  },
);

router.delete(
  "/admin/events/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateEventParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [event] = await db
      .delete(eventsTable)
      .where(eq(eventsTable.id, params.data.id))
      .returning();
    if (!event) {
      res.status(404).json({ error: "Event not found." });
      return;
    }
    res.sendStatus(204);
  },
);

router.get(
  "/admin/achievements",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const achievements = await db
      .select()
      .from(achievementsTable)
      .orderBy(desc(achievementsTable.achievedYear));
    res.json(ListAdminAchievementsResponse.parse(achievements));
  },
);

router.post(
  "/admin/achievements",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = CreateAchievementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [achievement] = await db
      .insert(achievementsTable)
      .values(parsed.data)
      .returning();
    res
      .status(201)
      .json(CreateAchievementResponse.parse(achievement));
  },
);

router.patch(
  "/admin/achievements/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateAchievementParams.safeParse(req.params);
    const body = UpdateAchievementBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Invalid request.",
      });
      return;
    }
    const [achievement] = await db
      .update(achievementsTable)
      .set(body.data)
      .where(eq(achievementsTable.id, params.data.id))
      .returning();
    if (!achievement) {
      res.status(404).json({ error: "Achievement not found." });
      return;
    }
    res.json(UpdateAchievementResponse.parse(achievement));
  },
);

router.delete(
  "/admin/achievements/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateAchievementParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [achievement] = await db
      .delete(achievementsTable)
      .where(eq(achievementsTable.id, params.data.id))
      .returning();
    if (!achievement) {
      res.status(404).json({ error: "Achievement not found." });
      return;
    }
    res.sendStatus(204);
  },
);

router.get("/admin/media", requireAdmin, async (_req, res): Promise<void> => {
  const media = await db
    .select()
    .from(mediaTable)
    .orderBy(mediaTable.sortOrder, desc(mediaTable.createdAt));
  res.json(ListAdminMediaResponse.parse(media.map(withMediaUrl)));
});

router.post("/admin/media", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (
    !parsed.data.objectPath.startsWith("/objects/uploads/") ||
    (parsed.data.isHeroVideo && parsed.data.mediaType !== "video")
  ) {
    res.status(400).json({ error: "Select a valid uploaded media file." });
    return;
  }

  const admin = res.locals.admin as { userId: string };
  try {
    await objectStorage.trySetObjectEntityAclPolicy(parsed.data.objectPath, {
      owner: admin.userId,
      visibility: "public",
    });
  } catch (error) {
    req.log.warn({ err: error }, "Uploaded media file was not found");
    res.status(400).json({ error: "The uploaded media file could not be found." });
    return;
  }

  const [media] = await db.transaction(async (tx) => {
    if (parsed.data.isHeroVideo) {
      await tx
        .update(mediaTable)
        .set({ isHeroVideo: false })
        .where(eq(mediaTable.isHeroVideo, true));
    }
    return tx.insert(mediaTable).values(parsed.data).returning();
  });
  res.status(201).json(CreateMediaResponse.parse(withMediaUrl(media)));
});

router.patch(
  "/admin/media/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateMediaParams.safeParse(req.params);
    const body = UpdateMediaBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error: !params.success
          ? params.error.message
          : !body.success
            ? body.error.message
            : "Invalid request.",
      });
      return;
    }

    const [existing] = await db
      .select()
      .from(mediaTable)
      .where(eq(mediaTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Media item not found." });
      return;
    }
    if (body.data.isHeroVideo && existing.mediaType !== "video") {
      res.status(400).json({ error: "Only video files can be the hero video." });
      return;
    }

    const [media] = await db.transaction(async (tx) => {
      if (body.data.isHeroVideo) {
        await tx
          .update(mediaTable)
          .set({ isHeroVideo: false })
          .where(eq(mediaTable.isHeroVideo, true));
      }
      return tx
        .update(mediaTable)
        .set(body.data)
        .where(eq(mediaTable.id, params.data.id))
        .returning();
    });
    res.json(UpdateMediaResponse.parse(withMediaUrl(media)));
  },
);

router.delete(
  "/admin/media/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateMediaParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [media] = await db
      .select()
      .from(mediaTable)
      .where(eq(mediaTable.id, params.data.id));
    if (!media) {
      res.status(404).json({ error: "Media item not found." });
      return;
    }

    try {
      const objectFile = await objectStorage.getObjectEntityFile(media.objectPath);
      await objectFile.delete({ ignoreNotFound: true });
    } catch (error) {
      req.log.error({ err: error }, "Could not delete media object");
      res.status(502).json({ error: "The media file could not be deleted." });
      return;
    }

    await db.delete(mediaTable).where(eq(mediaTable.id, params.data.id));
    res.sendStatus(204);
  },
);

export default router;
